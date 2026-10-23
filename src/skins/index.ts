import type { SkinRenderer } from './types'
import { Md3SkinRenderer } from './md3'
import { AnimeSkinRenderer } from './anime'
import { NewspaperSkinRenderer } from './newspaper'
import { ArtSkinRenderer } from './art'
import { ScrapbookSkinRenderer } from './scrapbook'

class SkinRegistry {
    private skins = new Map<string, SkinRenderer>()

    constructor() {
        const renderers = [
            new Md3SkinRenderer(),
            new AnimeSkinRenderer(),
            new NewspaperSkinRenderer(),
            new ArtSkinRenderer(),
            new ScrapbookSkinRenderer()
        ]
        for (const renderer of renderers) this.register(renderer)
    }

    register(skin: SkinRenderer) {
        this.skins.set(skin.id, skin)
    }

    getSafe(id: string): SkinRenderer {
        return this.skins.get(id) || this.skins.get('md3')
    }
}

export const skinRegistry = new SkinRegistry()

export type { SkinRenderer } from './types'
export { getAvatarUrl } from './types'
export { Md3SkinRenderer } from './md3'
export { AnimeSkinRenderer } from './anime'
export { NewspaperSkinRenderer } from './newspaper'
export { ArtSkinRenderer } from './art'
export { ScrapbookSkinRenderer } from './scrapbook'
