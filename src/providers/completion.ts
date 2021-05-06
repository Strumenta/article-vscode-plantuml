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
import {ExtractNamesVisitor} from "../plantuml/intellisense/extractNamesVisitor";
import {diagramAt} from "../plantuml/diagram/tools";
import {VariableCompletionItems} from "../plantuml/intellisense/variableCompletion";
import {MacroCompletionItems} from "../plantuml/intellisense/macroCompletion";
import {Diagram} from "../plantuml/diagram/diagram";

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

    public provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken) {
        const diagram = diagramAt(document, position);
        return Promise.all([
            MacroCompletionItems(diagram, position, token),
            this.computeSuggestions(diagram, position),
            VariableCompletionItems(diagram, position, token),
        ]).then(
            results => [].concat(...results)
        );
    }

    async computeSuggestions(diagram: Diagram, position: vscode.Position) {
        const input = CharStreams.fromString(diagram.content);
        const lexer = new PumlgLexer(input);
        const tokenStream = new CommonTokenStream(lexer);
        const parser = new PumlgParser(tokenStream);
        const parseTree = parser.uml();

        const caretPosition: CaretPosition = {line: position.line + 1 - diagram.start.line, column: position.character};
        let tkPos = this.computeTokenPosition(caretPosition, parseTree, tokenStream.getTokens());
        if (!tkPos) {
            tkPos = {index: 0, text: '', token: new CommonToken(-1), context: parseTree}
        }
        const core = new CodeCompletionCore(parser);
        core.ignoredTokens = new Set<number>([
            PumlgLexer.EOF, PumlgLexer.WS, PumlgLexer.ANYTHING_ELSE, PumlgLexer.NEWLINE,
            PumlgLexer.ABSTRACT_MOD, PumlgLexer.STATIC_MOD,
            PumlgLexer.COLON, PumlgLexer.COMMA,
            PumlgLexer.BLOCK_COMMENT,
            PumlgLexer.LPAREN, PumlgLexer.LCURLY, PumlgLexer.LSQUARE,
            PumlgLexer.RPAREN, PumlgLexer.RCURLY, PumlgLexer.RSQUARE,]);
        core.preferredRules = new Set<number>([PumlgParser.RULE_class_name]);
        let candidates = core.collectCandidates(tkPos.index, parseTree);
        const suggestions: CompletionItem[] = [];
        if (candidates.rules.size > 0) {
            const visitor = new ExtractNamesVisitor();
            if (candidates.rules.has(PumlgParser.RULE_class_name)) {
                visitor.visit(parseTree);
                for (const name of visitor.classNames) {
                    suggestions.push({label: name, kind: CompletionItemKind.Class, sortText: `00_${name}`});
                }
            }
        }
        candidates.tokens.forEach((l, k) => {
            if (k == PumlgParser.IDENT) {
                return;
                //Skip, we’ve already handled it above
            }
            if (k == PumlgParser.CONNECTOR) {
                const connectors = [
                    '--', '..', '-->', '<--', '--*', '*--', '--o', 'o--', '<|--', '--|>', '..|>', '<|..',
                    '*-->', '<--*', 'o-->', '<--o', '.', '->', '<-', '-*', '*-', '-o', 'o-', '<|-', '-|>', '.|>', '<|.',
                    '*->', '<-*', 'o->', '<-o'];
                connectors.forEach((c, i) => {
                    suggestions.push({label: c, kind: CompletionItemKind.Keyword, sortText: `01_${i}`});
                })
                return;
            }
            let suggestion = '';
            [k, ...l].forEach(i => {
                const symbolicName = parser.vocabulary.getSymbolicName(i)?.toLowerCase();
                if (symbolicName) {
                    if (suggestion) {
                        suggestion += " ";
                    }
                    suggestion += symbolicName;
                }
            });
            if (suggestion) {
                suggestions.push({label: suggestion, kind: CompletionItemKind.Keyword, sortText: `02_${suggestion}`});
            }
        });
        return suggestions;
    }

    resolveCompletionItem?(item: vscode.CompletionItem, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CompletionItem> {
        // TODO: add item.documentation
        return null;
    }

    findContext(parseTree: ParseTree, tokens: Token[], index: number): ParseTree | undefined {
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
            const context = this.findContext(parseTree.getChild(i), tokens, index);
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

