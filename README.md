# CoffeeScript IntelliSense Extension using tsserver

## Functionality

This extension provides Intellisense for CoffeeScript. This works not by leveraging CS AST but by compiling it to JS and asking tsserver for completions, diagnostics etc., while mapping the results using source maps.

Although this works great in principle, there are limitations to this approach:
- No complex source code altering features can be implemented like refactoring, formatting, snippets
- Local context can sometimes be missing in autocompletion (TODO explain this)

Overall, the following features of the Language Server Protocol are implemented:
TODO

TODO rewrite this extension using coffeescript, proving its potential usefulness