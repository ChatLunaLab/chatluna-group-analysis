import { SkinRenderer } from './types'
import { Md3SkinRenderer } from './md3'
import { AnimeSkinRenderer } from './anime'
import { NewspaperSkinRenderer } from './newspaper'
import { ArtSkinRenderer } from './art'
import { ScrapbookSkinRenderer } from './scrapbook'

/**
 * Skin registry
 * Manages all available skin renderers
 */
class SkinRegistry {
    private skins: Map<string, SkinRenderer> = new Map()

    constructor() {
        // Register built-in skins
        this.register(new Md3SkinRenderer())
        this.register(new AnimeSkinRenderer())
        this.register(new NewspaperSkinRenderer())
        this.register(new ArtSkinRenderer())
        this.register(new ScrapbookSkinRenderer())
    }

    /**
     * Register a skin renderer
     * @param skin Skin renderer instance
     */
    register(skin: SkinRenderer): void {
        this.skins.set(skin.id, skin)
    }

    /**
     * Get a skin renderer by ID
     * @param id Skin ID
     * @returns Skin renderer or undefined if not found
     */
    get(id: string): SkinRenderer | undefined {
        return this.skins.get(id)
    }

    /**
     * Get a skin renderer by ID, falling back to default if not found
     * @param id Skin ID
     * @returns Skin renderer (never undefined, falls back to md3)
     */
    getSafe(id: string): SkinRenderer {
        return this.skins.get(id) || this.skins.get('md3')!
    }

    /**
     * Check if a skin exists
     * @param id Skin ID
     * @returns True if skin exists
     */
    has(id: string): boolean {
        return this.skins.has(id)
    }

    /**
     * Get all registered skin IDs
     * @returns Array of skin IDs
     */
    getAllIds(): string[] {
        return Array.from(this.skins.keys())
    }

    /**
     * Get all registered skin renderers
     * @returns Array of skin renderers
     */
    getAll(): SkinRenderer[] {
        return Array.from(this.skins.values())
    }
}

// Export singleton instance
export const skinRegistry = new SkinRegistry()

// Re-export types and individual skins
export { SkinRenderer, getAvatarUrl } from './types'
export { Md3SkinRenderer } from './md3'
export { AnimeSkinRenderer } from './anime'
export { NewspaperSkinRenderer } from './newspaper'
export { ArtSkinRenderer } from './art'
export { ScrapbookSkinRenderer } from './scrapbook'