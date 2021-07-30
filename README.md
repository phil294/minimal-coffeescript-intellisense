# CoffeeScript IntelliSense Extension using tsserver

## Functionality

This extension provides Intellisense, syntax checking and type checking for CoffeeScript. This works not by leveraging CS AST but by compiling it to JS and asking tsserver for completions, diagnostics etc., while mapping the results using source maps.

### Features

- Syntax checking: CS -> JS compilation errors
- Type checking using TS based on JS, function signatures, JSDoc, TS dependencies. Check out [JS Projects Utilizing TypeScript]https://www.typescriptlang.org/docs/handbook/intro-to-js-ts.html) on how to leverage this the best way. A `//@ts-check` is inserted automatically for you at the beginning of the file.
	((gif:
		x = a: 1
		x.a = 'text' # error
	))
- The following IntelliSense features of the Language Server Protocol are implemented:
	- TODO

```
unrelated TODOs:
vscode suggestions should show extension name?
```

Although this works great in principle, there are limitations to this approach:
- No complex source code altering features can be implemented like refactoring, formatting, snippets
- Local context can sometimes be missing in autocompletion (TODO explain this)
- Performance is probably pretty horrible / resource intensive. Should not be *too* bad though, as this extension builds on the shoulders of blazingly fast compilers and just glues them together

Not yet implemented but possible in principle:
- Cross-file autocompletion: Import autocompletion works if the imported module is native JavaScript. If you are trying to import from another CS file, that file won't be compiled and parsed yet

TODO rewrite this extension using coffeescript, proving its potential usefulness