import { h } from 'koishi'

const pattern = /\[CQ:(\w+)((,\w+=[^,\]]*)*)\]/

export function parseCQCode(source: string): h[] {
    const elements: h[] = []
    let capture: RegExpExecArray

    while ((capture = pattern.exec(source))) {
        const [, type, rawAttrs] = capture
        if (capture.index)
            elements.push(
                h('text', { content: unescape(source.slice(0, capture.index)) })
            )

        const data: Record<string, string> = {}
        if (rawAttrs) {
            rawAttrs
                .slice(1)
                .split(',')
                .forEach((attr) => {
                    const index = attr.indexOf('=')
                    data[attr.slice(0, index)] = unescape(attr.slice(index + 1))
                })
        }
        elements.push(h(type, data))
        source = source.slice(capture.index + capture[0].length)
    }

    if (source) elements.push(h('text', { content: unescape(source) }))
    return elements
}

function unescape(source: string) {
    return source
        .replace(/&#91;/g, '[')
        .replace(/&#93;/g, ']')
        .replace(/&#44;/g, ',')
        .replace(/&amp;/g, '&')
}
