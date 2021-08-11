//@ts-check

const { commands, ExtensionContext, languages, Position, Range, Uri, workspace, CompletionList, Diagnostic, DiagnosticSeverity, window, TextDocumentChangeEvent } = require('vscode')
const { LanguageClient, TransportKind } = require('vscode-languageclient/node')
const CoffeeScript = require('coffeescript')
//@ts-ignore
const VolatileMap = require('volatile-map').default
//@ts-ignore
const MD5 = new (require('jshashes').MD5)()
const ts_morph = require('ts-morph')
const path = require('path')

const language = 'coffeescript'
const ext_identifier = 'coffeescript-intellisense-js-based'

/** @type {NodeJS.Timeout} */
let coffee_compile_debouncer

/** @type {Map<string,ReturnType<coffee_compile>>} */
const compilation_cache = new VolatileMap(180000)

/** @type {ts_morph.Project} */
let ts_project
/** @type {ts_morph.SourceFile} */
let ts_source_file

/** @type {LanguageClient} */
let client

/*******************************************************
 * 
 * This extension uses coffeescript compiler for CS compilation errors and
 * transforming into JS,
 * uses request forwarding to vsc ts service for JS completions,
 * ts-morph for JS syntax checking,
 * theia-language-server (TS) for JS gotos only (treating CS as JS).
 * 
 * Please use https://github.com/phil294/coffeesense instead of this extension.
 *
 ******************************************************/

/**
 * Attempts to compile and return js and sourceMap, or, if failing to do so,
 * compile error diagnostics. Caches results for several seconds.
 * @param text {string}
 * @returns {{ diagnostics?: Diagnostic[], js?: string, source_map?: CoffeeScript.LineMap[] }}
 */
function coffee_compile(text) {
	const hash = MD5.hex(text)
	const cached = compilation_cache.get(hash)
	if (cached)
		return cached
	let result
	try {
		const response = CoffeeScript.compile(text, { sourceMap: true, bare: true })
		result = {
			source_map: response.sourceMap.lines,
			js: response.js.trim()
		}
	} catch (e) {
		if (e.name !== "SyntaxError")
			throw e
		const l = e.location
		result = {
			diagnostics: [new Diagnostic(new Range(l.first_line, l.first_column, l.last_line, l.last_column + 1), e.message, DiagnosticSeverity.Error)]
		}
	}
	compilation_cache.set(hash, result)
	return result
}
/**
 * Compiles ts code into js and returns only diagnostics. Very slow
 * @param text {string}
 * @returns {Promise<ReturnType<coffee_compile>>}
 */
async function ts_compile(text) {
	const hash = MD5.hex(text)
	const cached = compilation_cache.get(hash)
	if (cached)
		return cached
	// For JS type checking (using tsserver), there does not seem to be any vscode api available
	// as diagnostics are always push-only. So we need to spin up yet another server:
	if (!ts_project) {
		ts_project = new ts_morph.Project({
			useInMemoryFileSystem: true,
			compilerOptions: {
				allowJs: true,
				alwaysStrict: true,
				// noImplicitAny: true,
				strictNullChecks: true,
				target: ts_morph.ScriptTarget.ESNext,
			}
		})
		// Can't easily use `.js` in this library, but `.ts` does the same thing anyway
		ts_source_file = ts_project.createSourceFile(ext_identifier + ".ts", '')
	}
	ts_source_file.replaceWithText(text)
	await ts_project.save()
	// https://github.com/dsherret/ts-morph/issues/1182
	const pre_emit_diagnostics = ts_project.getPreEmitDiagnostics()
	const emit_result = ts_project.emitToMemory()
	// const emit_diagnostics = emit_result.getDiagnostics()
	const result = { diagnostics: pre_emit_diagnostics.filter(d =>
			! d.compilerObject.messageText.toString().startsWith("Cannot find module")
		).map(d => {
		const m = d.getMessageText()
		const message = typeof m === 'string' ? m : m.getMessageText()
		return new Diagnostic(new Range(
			// ts-morph only returns line and total pos, not inline character.
			// Transforming this is annoying so we just highlight the whole line
			d.getLineNumber() || 0, 0, d.getLineNumber() || 0, 0
		), message, DiagnosticSeverity.Error)
	}) }
	compilation_cache.set(hash, result)
	return result
}

function activate(/** @type {ExtensionContext} */ context) {
	const { subscriptions } = context

	let server_module = context.asAbsolutePath(
		path.join('node_modules', '.bin', 'typescript-language-server')
	)
	let base_server_options = {
		module: server_module,
		transport: TransportKind.ipc,
		options: {
		},
	}
	let server_options = {
		run: base_server_options,
		debug: {
			...base_server_options,
			options: {
				...base_server_options.options,
				execArgv: ['--nolazy', '--inspect=6009'],
			}
		}
	}
	let client_options = {
		documentSelector: [{ scheme: 'file', language: 'coffeescript' }],
		// Disable pretty much everything except go to and completion
		middleware: {
			handleDiagnostics: Boolean,
			provideCodeActions: () => undefined,
			provideDocumentFormattingEdits: () => undefined,
			provideOnTypeFormattingEdits: () => undefined,
			provideRenameEdits: () => undefined,
			prepareRename: () => undefined,
			executeCommand: Boolean,
			provideFoldingRanges: () => undefined,
			provideLinkedEditingRange: () => undefined,
		}
	}
	client = new LanguageClient(ext_identifier, ext_identifier, server_options, client_options)
	// Start the client. This will also launch the server
	client.start()

	const diagnostic_collection = languages.createDiagnosticCollection(ext_identifier)
	subscriptions.push(diagnostic_collection)

	const virtual_document_contents = new Map()

	/*
		To enable intellisense for compiled output, virtual documents in a custom file scheme
		are necessary. This approach is based on "Embedded Languages / Request Forwarding" @
		https://code.visualstudio.com/api/language-extensions/embedded-languages#request-forwarding-sample.
	*/
	subscriptions.push(workspace.registerTextDocumentContentProvider(ext_identifier, {
		// This is a lookup service that is unfortunately required and otherwise not really interesting
		provideTextDocumentContent: uri => {
			// Remove leading slash and trailing `.js`
			const original_uri = uri.path.slice(1).slice(0, -3)
			const decoded_uri = decodeURIComponent(original_uri)
			const virtual_content = virtual_document_contents.get(decoded_uri)
			return virtual_content
		}
	}))
	
	const check_syntax = () => {
		const active_document = window.activeTextEditor?.document
		if(!active_document || active_document.languageId !== language)
			return
		diagnostic_collection.clear()
		if (coffee_compile_debouncer)
			clearTimeout(coffee_compile_debouncer)
		coffee_compile_debouncer = setTimeout(async () => {
			const { js, source_map, diagnostics: coffee_diagnostics } = coffee_compile(active_document.getText())
			if (!js || !source_map) {
				diagnostic_collection.set(active_document.uri, coffee_diagnostics)
				return
			}

			const { diagnostics: ts_diagnostics = [] } = await ts_compile(js)
			const mapped_diagnostics = ts_diagnostics.map(d => {
				// idk but both -1 and -0 were necessary in different files. not sure where my error is. I think -1 is the normal case
				const mapped_start = (source_map[d.range.start.line-1]||source_map[d.range.start.line]||source_map[d.range.start.line+1])?.columns.find(Boolean)
				const mapped_end = (source_map[d.range.end.line-1]||source_map[d.range.end.line]||source_map[d.range.end.line+1])?.columns.find(Boolean)
				if(!mapped_start || !mapped_end)
					throw new Error('could not sourcemap js back to cs')
				return {
					...d,
					range: new Range(
						new Position(mapped_start.sourceLine, 0),
						new Position(mapped_end.sourceLine, Number.MAX_VALUE))
				}
			})
			diagnostic_collection.set(active_document.uri, mapped_diagnostics)
		}, 500)
	}
	subscriptions.push(workspace.onDidChangeTextDocument(change_event => {
		const active_document = change_event.document
		if (active_document !== window.activeTextEditor?.document)
			return
		check_syntax()
	}))
	subscriptions.push(workspace.onDidOpenTextDocument(check_syntax))

	subscriptions.push(languages.registerCompletionItemProvider(language, {
		async provideCompletionItems(document, real_coffee_position, token) {
			let coffee = document.getText()
			const current_line = document.lineAt(real_coffee_position.line).text
			const current_line_indentation = (current_line.match(/^\s+/) || [])[0] || ''

			// Proper lsp servers can handle autocompletion requests even when the surrounding code is invalid.
			// This is not possible with this extension so we temporarily replace the current line (indented)
			// with `true`, reverse-map the location of that in the compiled JS (if successful) and insert the
			// current line again at that position, as JS completion *can* be based on half-baked code
			coffee = [
				coffee.substr(0, document.offsetAt(real_coffee_position.with(undefined, 0))),
				current_line_indentation,
				'true',
				coffee.substr(document.offsetAt(real_coffee_position.with(undefined, current_line.length)))
			].join('')
			const coffee_true_position = real_coffee_position.with(undefined, current_line_indentation.length)
			const compile_result = coffee_compile(coffee)
			if (!compile_result.js || !compile_result.source_map)
				return
			const js_true_line = compile_result.source_map
				.map(line => line?.columns
					.find(c => c?.sourceLine === coffee_true_position.line && c.sourceColumn === coffee_true_position.character))
				.flat()
				.find(Boolean)
				?.line
			if(!js_true_line)
				return
			const js_arr = compile_result.js.split('\n')
			js_arr[js_true_line] = current_line
			const js = js_arr.join('\n')
			const emulated_cursor_position = new Position(js_true_line, current_line.length)

			const original_uri = document.uri.toString()
			virtual_document_contents.set(original_uri, js)
			// The `.js` is what makes vscode turn to tsserver for the completion request
			const virtual_document_uri = Uri.parse(`${ext_identifier}://compiled/${encodeURIComponent(original_uri)}.js`)
			/** @type {CompletionList|undefined} */
			const completion_list = await commands.executeCommand('vscode.executeCompletionItemProvider', virtual_document_uri, emulated_cursor_position)

			// Now the completions are there based on JS but their position does not fit to coffee. Complicated backwards
			// mapping is not necessary as they can all simply be mapped to current coffee cursor position:
			const real_coffee_position_one_left = real_coffee_position.with(undefined, real_coffee_position.character - 1)
			for (const item of completion_list?.items || []) {
				if (item.range instanceof Range) {
					const range = new Range(real_coffee_position_one_left, real_coffee_position)
					item.range = range
					if (item.textEdit)
						item.textEdit.range = range
				} else if (item.range?.replacing) {
					const range = new Range(real_coffee_position, real_coffee_position)
					item.range.replacing = range
					item.range.inserting = range
				}
			}
			return completion_list?.items
		}
	}, '.', '\"'))
}

function deactivate() {
	if (!client)
		return undefined
	return client.stop()
}

module.exports = { activate, deactivate }