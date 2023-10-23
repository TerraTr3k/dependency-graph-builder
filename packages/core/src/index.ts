import { Parser } from 'acorn'
import * as acornWalk from 'acorn-walk'
import * as fs from 'fs'
import * as path from 'path'

class DepsGraph {
    nodes: Node[]
    options: {
        entry: string
        aliases: { [key: string]: string }
    }
    constructor(entry: string, aliases: { [key: string]: string }) {
        this.nodes = []
        this.options = {
            entry: entry,
            aliases: aliases
        }
        this.init()
    }
    init() {
        this.generate(this.options.entry)
    }
    resolveAlias(filepath: string) {
        for (const alias in this.options.aliases) {
            if (filepath.startsWith(alias)) {
                return path.resolve(this.options.aliases[alias], filepath.slice(alias.length))
            }
        }
        return filepath
    }
    isInternalModule(filepath: string) {
        const resolvedPath = this.resolveAlias(filepath)
        return fs.existsSync(resolvedPath)
    }
    getNodesByFilepath(filepath: string) {
        return this.nodes.filter(node => node.filepath === filepath)
    }
    addNode(node: Node) {
        this.nodes.push(node)
    }
    generate(entry: string) {
        const code = fs.readFileSync(entry, 'utf-8')
        const entryNode = new Node(entry, code)
        this.addNode(entryNode)
        this.buildDepsGraph(entryNode, [])
    }
    buildDepsGraph(node: Node, parentDeps: string[]) {
        const { deps } = node
        deps.forEach(dep => {
            const depPath = path.join(path.dirname(node.filepath), dep)
            if (fs.existsSync(depPath)) {
                if (parentDeps.includes(depPath)) {
                    console.log(`循环依赖：${depPath}`)
                    return
                }
                const code = fs.readFileSync(depPath, 'utf-8')
                const depNode = new Node(depPath, code)
                this.addNode(depNode)
                this.buildDepsGraph(depNode, [...parentDeps, node.filepath])
            }
        })
    }
    // 获取指定文件的依赖
    getDirectDependencies(filepath: string) {
        const node = this.nodes.find(node => node.filepath === filepath)
        return node ? node.deps : []
    }
}

class Node {
    filepath: string
    code: string
    deps: string[]
    plugins: ((node: any) => string[])[]

    constructor(filepath: string, code: string, plugins: ((node: any) => string[]) = []) {
        this.filepath = filepath
        this.code = code
        this.plugins = plugins
        this.deps = this.getDependencies()
    }

    getDependencies() {
        const ast = Parser.parse(this.code, {
            sourceType: 'module',
            locations: true,
            ecmaVersion: 2020
        })

        let deps = []

        acornWalk.full(ast, (node) => {
            if (node.type === 'ImportDeclaration') {
                deps.push(node.source.value)
            } else if (node.type === 'CallExpression' && node.callee.name === 'require' && node.arguments[0] && node.arguments[0].type === 'Literal') {
                deps.push(node.arguments[0].value)
            }
            this.plugins.forEach(plugin => {
                deps = deps.concat(plugin(node))
            })
        })

        return deps
    }
}