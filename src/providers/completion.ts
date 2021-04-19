import * as vscode from 'vscode';
import {CompletionItem, CompletionItemKind} from 'vscode';
import {languageid} from '../plantuml/common';
import {ErrorNode, ParseTree} from "antlr4ts/tree";
import {Token} from "antlr4ts/Token";
import {Lexer} from "antlr4ts/Lexer";
import {CodeCompletionCore} from "antlr4-c3";
import {CharStreams, CommonToken, CommonTokenStream} from "antlr4ts";
import {PumlgLexer} from "../parser/PumlgLexer";
import {PumlgParser} from "../parser/PumlgParser";

export type CaretPosition = { line: number, column: number };
export type TokenPosition = { index: number, token: Token, context?: ParseTree, text: string };

export class Completion extends vscode.Disposable implements vscode.CompletionItemProvider {
    private _disposables: vscode.Disposable[] = [];

    constructor() {
        super(() => this.dispose());
        let sel: vscode.DocumentSelector = [
            { scheme: 'file', language: languageid },
            { scheme: 'untitled', language: languageid },
        ];
        this._disposables.push(
            vscode.languages.registerCompletionItemProvider(sel, this)
        );
    }

    dispose() {
        this._disposables && this._disposables.length && this._disposables.map(d => d.dispose());
    }

    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken)
        : Thenable<vscode.CompletionItem[]> {
        const input = CharStreams.fromString(document.getText());
        const lexer = new PumlgLexer(input);
        const tokenStream = new CommonTokenStream(lexer);
        const parser = new PumlgParser(tokenStream);

        const caretPosition: CaretPosition = { line: position.line + 1, column: position.character };
        const parseTree = parser.umlFile();
        let tkPos = this.computeTokenPosition(caretPosition, parseTree, tokenStream.getTokens());
        if (!tkPos) {
            tkPos = { index: 0, text: '', token: new CommonToken(-1), context: parseTree }
        }
        const core = new CodeCompletionCore(parser);
        let candidates = core.collectCandidates(tkPos.index);
        const keywords: string[] = [];
        candidates.tokens.forEach((l, k) => {
            if (k == PumlgParser.IDENT) {
                return;
                //Skip, we’ve already handled it above
            }
            let suggestion = '';
            [k, ...l].forEach(i => {
                const symbolicName = parser.vocabulary.getSymbolicName(i);
                if(symbolicName) {
                    if(suggestion) {
                        suggestion += " ";
                    }
                    suggestion += symbolicName;
                }
            });
            if (suggestion) {
                keywords.push(suggestion);
            }
        });
        return new Promise<vscode.CompletionItem[]>(resolve => {
            const suggestions: CompletionItem[] = keywords.map(k => {
                return { label: k, kind: CompletionItemKind.Keyword }
            });
            resolve(suggestions);
        });
        /*let diagram = diagramAt(document, position);
        return Promise.all([
            MacroCompletionItems(diagram, position, token),
            LanguageCompletionItems(),
            VariableCompletionItems(diagram, position, token),
        ]).then(
            results => [].concat(...results)
        )*/
    }

    resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
        // TODO: add item.documentation
        return null;
    }

    findContext(parseTree: ParseTree, tokens: Token[], index: number, previous?: ParseTree): ParseTree | undefined {
        let token = tokens[index];
        while((token.type == Lexer.EOF || token.channel != Lexer.DEFAULT_TOKEN_CHANNEL) && index > 0) {
            index--;
            token = tokens[index];
        }
        let startToken: Token, stopToken: Token;
        if('symbol' in parseTree) {
            startToken = stopToken = parseTree['symbol'];
        } else {
            startToken = (parseTree as any)['start'];
            stopToken = (parseTree as any)['stop'];
        }
        if(!startToken || !stopToken || startToken.startIndex > token.startIndex || stopToken.stopIndex < token.stopIndex) {
            return undefined;
        }
        for(let i = 0; i < parseTree.childCount; i++) {
            let prevChild = i > 0 ? parseTree.getChild(i - 1) : undefined;
            const context = this.findContext(parseTree.getChild(i), tokens, index, prevChild);
            if(context && !(context instanceof ErrorNode)) {
                return context;
            }
        }
        if(startToken.startIndex <= token.startIndex && stopToken.stopIndex >= token.stopIndex) {
            return parseTree;
        } else {
            return undefined;
        }
    }

    computeTokenPosition(caretPosition: CaretPosition, parseTree: ParseTree, tokens: Token[]): TokenPosition | undefined {
        for(let index = 0; index < tokens.length; index++) {
            const token = tokens[index];
            let text = ((token.type != Lexer.EOF) && token.text) ? token.text : '';
            let start = token.charPositionInLine;
            let stop = token.charPositionInLine + text.length;
            if (token.line == caretPosition.line && start <= caretPosition.column && stop >= caretPosition.column) {
                const context = this.findContext(parseTree, tokens, index);
                if(token.channel != Lexer.DEFAULT_TOKEN_CHANNEL) {
                    index++;
                    text = '';
                } else {
                    text = text.substring(0, caretPosition.column - start);
                }
                return { context, index, text, token };
            }
        }
        return undefined;
    }
}

