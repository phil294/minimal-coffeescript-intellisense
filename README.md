This is a demo extension. Please use https://github.com/phil294/coffeesense instead.

(it is referenced in https://github.com/phil294/coffeesense/blob/master/CONTRIBUTING.md)

If you really want to use this, you need to modify `node_modules/vscode-languageclient/lib/node/main.js` and remove `args.push(`--clientProcessId=${process.pid.toString()}`);` in both places (or fork this dependency and update package.json accordingly) because Theia TS LSP [does not understand this option](https://github.com/microsoft/vscode-languageserver-node/issues/794).