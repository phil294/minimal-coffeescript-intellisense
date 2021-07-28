import { readFile } from 'fs'
import * as path from 'path'
import { promisify } from 'util'
import { commands, EventEmitter, Range, window } from 'vscode'
import { workspace, ExtensionContext, TextDocument, Position, CompletionContext, CancellationToken, CompletionList, TextDocumentChangeEvent, TextDocumentContentProvider, Uri } from 'vscode'
import { LanguageClient, LanguageClientOptions, ProvideCompletionItemsSignature, ServerOptions, TransportKind } from 'vscode-languageclient/node'

let client: LanguageClient

export async function activate(context: ExtensionContext) {

	const virtualDocumentContents = new Map<string, string>();

	workspace.registerTextDocumentContentProvider('embedded-content', {
		provideTextDocumentContent: uri => {
			const originalUri = uri.path.slice(1).slice(0, -3);
			const decodedUri = decodeURIComponent(originalUri);
			const virtual_content = virtualDocumentContents.get(decodedUri);
			return virtual_content;
		}
	});

	let serverModule = context.asAbsolutePath(
		// path.join('server', 'out', 'server.js')
		path.join('server', 'node_modules', '.bin', 'typescript-language-server')
	)
	let base_server_options = {
		module: serverModule,
		transport: TransportKind.ipc,
		options: {
		},
	}
	let serverOptions: ServerOptions = {
		run: base_server_options,
		debug: {
			...base_server_options,
			options: {
				...base_server_options.options,
				execArgv: ['--nolazy', '--inspect=6009'],
			}
		}
	}

	let clientOptions: LanguageClientOptions = {
		documentSelector: [{ scheme: 'file', language: 'coffeescript' }],
		middleware: {
			async provideCompletionItem(document: TextDocument, position: Position, context: CompletionContext, token: CancellationToken, next: ProvideCompletionItemsSignature) {
				// const alteredPosition = new Position(position.line, position.character)
				// const result_items = result instanceof CompletionList ? result.items : result
				// for(let i = 0; i < 3 && i < result_items.length; i++) {
				// 	const item = result_items[i]
				// 	if((item as any).data.file !== document.fileName)
				// 		// Don't alter suggestions for other files
				// 		continue
				// 	item.label += ' MMM'
				// }
				// return result_items
				const originalUri = document.uri.toString();
				virtualDocumentContents.set(originalUri, 'ABC\nABC\nABC\n' + document.getText());
				const alteredPosition = new Position(position.line + 3, position.character)

				const vdocUriString = `embedded-content://compiled/${encodeURIComponent(originalUri)}.js`;
				const vdocUri = Uri.parse(vdocUriString);
				const completion_list = await commands.executeCommand<CompletionList>(
					'vscode.executeCompletionItemProvider',
					vdocUri,
					alteredPosition,
					context.triggerCharacter
				);
				for(const item of completion_list.items) {
					if(item.range instanceof Range) {
						const fixed_range = item.range.with(
							new Position(item.range.start.line - 3, item.range.start.character),
							new Position(item.range.end.line - 3, item.range.end.character));
						item.range = fixed_range;
						item.textEdit.range = fixed_range;
					}
				}
				return completion_list
			}
		},
	}

	// Create the language client and start the client.
	client = new LanguageClient('languageServerExample', 'Language Server Example', serverOptions, clientOptions)

	// Start the client. This will also launch the server
	client.start()
}

export function deactivate(): Thenable<void> | undefined {
	if (!client)
		return undefined
	return client.stop()
}
