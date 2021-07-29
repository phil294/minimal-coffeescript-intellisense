//@ts-check
const { commands, ExtensionContext, languages, Position, Range, Uri, workspace, CompletionList, Diagnostic, DiagnosticSeverity } = require('vscode')
const CoffeeScript = require('coffeescript')

const language = 'coffeescript'

/**
 * Attempts to compile and return js and sourceMap, or, if failing to do so,
 * compile error diagnostics
 * @param text {string}
 * returns {{diagnostics?: Diagnostic[], js?: string, source_map?: Array<{line:number,columns:Array<{line:number,column:number,sourceLine:number,sourceColumn:number}|undefined>}|undefined>}} TODO wrong in repo bc columns is not array?
 */
function compile(text) {
	try {
		const result = CoffeeScript.compile(text, { sourceMap: true, bare: true })
		return {
			source_map: result.sourceMap.lines,
			js: result.js.trim()
		}
	} catch(e) {
		if(e.name !== "SyntaxError")
			throw e
		const l = e.location
		return {
			diagnostics: [ new Diagnostic(new Range(l.first_line, l.first_column, l.last_line, l.last_column + 1), e.message, DiagnosticSeverity.Error) ]
		}
	}
}

function activate(/** @type {ExtensionContext} */ { subscriptions }) {

	const diagnostic_collection = languages.createDiagnosticCollection('ext-compiling-coffee') // todo replace with final extension name
	subscriptions.push(diagnostic_collection)
  
	const virtual_document_contents = new Map()

	/* See README for how this extension works.
	To enable intellisense for compiled output, virtual documents in a custom file scheme
	are necessary. This approach is based on "Embedded Languages / Request Forwarding" @
	https://code.visualstudio.com/api/language-extensions/embedded-languages#request-forwarding-sample.
	*/
	subscriptions.push(workspace.registerTextDocumentContentProvider('ext-compiled-javascript', { // todo replace with final extension name
		provideTextDocumentContent: uri => {
			const original_uri = uri.path.slice(1).slice(0, -3)
			const decoded_uri = decodeURIComponent(original_uri)
			const virtual_content = virtual_document_contents.get(decoded_uri)
			return virtual_content
		}
	}))
	subscriptions.push(
        languages.registerCompletionItemProvider(language, {
			async provideCompletionItems(document, real_coffee_position, token) {
				let coffee = document.getText()
				const current_line = document.lineAt(real_coffee_position.line).text
				const current_line_indentation = (current_line.match(/^ +/) || [])[0] || ''

				// Proper lsp servers can handle autocompletion requests even when the surrounding code is invalid.
				// This is not possible with this extension so we first try to compile as is...
				let compile_result = compile(coffee)
				if(!compile_result.js) {
					// ... and when that failed, replace the current line (indented) with `true` and try again.
					coffee = [
						coffee.substr(0, document.offsetAt(real_coffee_position.with(undefined, 0))),
						current_line_indentation, // < todo test
						'true',
						coffee.substr(document.offsetAt(real_coffee_position.with(undefined, current_line.length)))
					].join('')
					compile_result = compile(coffee)
				}
				if(!compile_result.js || !compile_result.source_map)
					return

				// Completion in the JS however *can* be based on invalid code, so we insert the current line again.
				// It would be better to do this at `real_coffee_position` instead of at the end like below but
				// this is somewhat tricky, TODO. It would enable local context and is thus very important
				const js = `${compile_result.js}\n${current_line}`
				const emulated_cursor_position = new Position(compile_result.source_map.length, current_line.length) // Very end of JS

				const original_uri = document.uri.toString()
				virtual_document_contents.set(original_uri, js)
				const virtual_document_uri = Uri.parse(`ext-compiled-javascript://compiled/${encodeURIComponent(original_uri)}.js`)
				// , context.triggerCharacter v todo
				/** @type {CompletionList|undefined} */
				const completion_list = await commands.executeCommand('vscode.executeCompletionItemProvider', virtual_document_uri, emulated_cursor_position)
				
				// Now the completions are there based on JS but their position does not fit to coffee. Complicated backwards
				// mapping is not necessary as they can all simply be mapped to current coffee cursor position:
				const real_coffee_position_one_left = real_coffee_position.with(undefined, real_coffee_position.character - 1)
				for(const item of completion_list?.items||[]) {
					if(item.range instanceof Range) {
						const range = new Range(real_coffee_position_one_left, real_coffee_position)
						item.range = range
						if(item.textEdit)
							item.textEdit.range = range
					} else if(item.range?.replacing) {
						const range = new Range(real_coffee_position, real_coffee_position)
						item.range.replacing = range
						item.range.inserting = range
					}
				}
				return completion_list?.items
			}
		}, '.', '\"'))
		// let compile_result = compile(coffee)
		// if(!compileResult.js || !compileResult.source_map) {
		// 	diagnostic_collection.clear()
		// 	diagnostic_collection.set(document.uri, compileResult.diagnostics)
		// 	return
		// }
}
module.exports = { activate }