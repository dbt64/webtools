const PLUGIN_CAPABILITIES = Object.freeze(['manager.page', 'plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write', 'external.open', 'clipboard.write', 'sharedAI.complete']);
export class PluginValidationError extends Error {
    constructor(code, path = 'manifest.json', field) { super(({ INVALID_MANIFEST: 'Manifest v1 is invalid.', INCOMPATIBLE_PLUGIN: 'Plugin API or minimum host version is incompatible.', INVALID_PACKAGE: 'Plugin package is invalid or exceeds a security limit.', INVALID_INPUT: 'A manifest value is invalid.' })[code] ?? 'Plugin validation failed.'); this.name = 'PluginValidationError'; this.code = code; this.path = path; if (field)
        this.field = field; this.suggestion = ({ INVALID_MANIFEST: 'Check the Manifest v1 field names, types, bounds, and references.', INCOMPATIBLE_PLUGIN: 'Target API major 1 and a supported minimum host version.', INVALID_PACKAGE: 'Remove unsafe or undeclared package entries and retry.', INVALID_INPUT: 'Correct the value using the published author types.' })[code] ?? 'Review the plugin validation error.'; }
}
export function failValidation(code, path, field) { throw new PluginValidationError(code, path, field); }
const fail = failValidation;
export const LIMITS = Object.freeze({ archive: 20 * 1024 * 1024, entries: 256, expanded: 50 * 1024 * 1024, png: 256 * 1024, manifest: 64 * 1024, ratio: 100, depth: 16, pages: 8, blocks: 64, actions: 32, settings: 64, value: 512 * 1024, keys: 200, data: 5 * 1024 * 1024 });
export const pluginIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const keyPattern = /^[a-zA-Z0-9_-]{1,64}$/;
const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
export function validPluginId(value) { return typeof value === 'string' && value.length >= 3 && value.length <= 128 && pluginIdPattern.test(value) && !forbiddenKeys.has(value); }
/** A small JSON grammar parser preserves duplicate-key information JSON.parse discards. */
export function parseStrictJson(source, maxDepth = LIMITS.depth) {
    let at = 0;
    const ws = () => { while (/\s/.test(source[at] ?? '') && at < source.length) {
        if (!/[\x20\t\r\n]/.test(source[at]))
            fail('INVALID_MANIFEST');
        at++;
    } };
    const string = () => {
        const start = at++;
        while (at < source.length) {
            if (source[at] === '\\') {
                at += 2;
                continue;
            }
            if (source[at++] === '"') {
                try {
                    return JSON.parse(source.slice(start, at));
                }
                catch {
                    fail('INVALID_MANIFEST');
                }
            }
        }
        fail('INVALID_MANIFEST');
    };
    const value = (depth) => {
        ws();
        if (source[at] === '"')
            return string();
        if (source[at] === '{' || source[at] === '[') {
            if (depth >= maxDepth)
                fail('INVALID_MANIFEST');
            const object = source[at++] === '{';
            const end = object ? '}' : ']';
            const result = {};
            const array = [];
            const seen = new Set();
            ws();
            if (source[at] === end) {
                at++;
                return object ? result : array;
            }
            for (;;) {
                ws();
                if (object) {
                    if (source[at] !== '"')
                        fail('INVALID_MANIFEST');
                    const key = string();
                    if (seen.has(key) || forbiddenKeys.has(key))
                        fail('INVALID_MANIFEST');
                    seen.add(key);
                    ws();
                    if (source[at++] !== ':')
                        fail('INVALID_MANIFEST');
                    result[key] = value(depth + 1);
                }
                else
                    array.push(value(depth + 1));
                ws();
                if (source[at] === end) {
                    at++;
                    return object ? result : array;
                }
                if (source[at++] !== ',')
                    fail('INVALID_MANIFEST');
            }
        }
        const rest = source.slice(at);
        for (const [word, parsed] of [['true', true], ['false', false], ['null', null]])
            if (rest.startsWith(word)) {
                at += word.length;
                return parsed;
            }
        const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
        if (number) {
            at += number[0].length;
            const n = Number(number[0]);
            if (!Number.isFinite(n))
                fail('INVALID_MANIFEST');
            return n;
        }
        fail('INVALID_MANIFEST');
    };
    const result = value(0);
    ws();
    if (at !== source.length)
        fail('INVALID_MANIFEST');
    return result;
}
export function record(value, required, optional = [], field) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        fail('INVALID_INPUT', 'manifest.json', field);
    const result = value;
    if (required.some(key => !Object.hasOwn(result, key)) || Object.keys(result).some(key => !required.includes(key) && !optional.includes(key)))
        fail('INVALID_INPUT', 'manifest.json', field);
    return result;
}
export function boundedString(value, max, min = 1, field) {
    if (typeof value !== 'string' || value.length < min || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
        fail('INVALID_INPUT', 'manifest.json', field);
    return value;
}
function array(value, max, field) { if (!Array.isArray(value) || value.length > max)
    fail('INVALID_MANIFEST', 'manifest.json', field); return value; }
export function opaqueKey(value, field) { const key = boundedString(value, 64, 1, field); if (!keyPattern.test(key) || forbiddenKeys.has(key))
    fail('INVALID_INPUT', 'manifest.json', field); return key; }
export function httpsLiteral(value, field) {
    const text = boundedString(value, 2048, 1, field);
    let url;
    try {
        url = new URL(text);
    }
    catch {
        fail('INVALID_INPUT', 'manifest.json', field);
    }
    if (!text.startsWith('https://') || url.protocol !== 'https:' || !url.hostname || url.username || url.password || /[\s\\]/.test(text))
        fail('INVALID_INPUT', 'manifest.json', field);
    return text;
}
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
export function versionParts(version, field) {
    const match = semverPattern.exec(boundedString(version, 128, 1, field));
    if (!match || match[4]?.split('.').some(part => /^\d+$/.test(part) && part.length > 1 && part[0] === '0'))
        fail('INVALID_INPUT', 'manifest.json', field);
    return match;
}
export function compareVersions(a, b) {
    const left = versionParts(a);
    const right = versionParts(b);
    for (let i = 1; i <= 3; i++) {
        const x = BigInt(left[i]);
        const y = BigInt(right[i]);
        if (x !== y)
            return x < y ? -1 : 1;
    }
    if (!left[4] || !right[4])
        return left[4] === right[4] ? 0 : left[4] ? -1 : 1;
    const x = left[4].split('.');
    const y = right[4].split('.');
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (x[i] === y[i])
            continue;
        if (x[i] === undefined || y[i] === undefined)
            return x[i] === undefined ? -1 : 1;
        const xn = /^\d+$/.test(x[i]);
        const yn = /^\d+$/.test(y[i]);
        if (xn && yn)
            return BigInt(x[i]) < BigInt(y[i]) ? -1 : 1;
        if (xn !== yn)
            return xn ? -1 : 1;
        return x[i] < y[i] ? -1 : 1;
    }
    return 0;
}
export function safeAssetPath(value, field) {
    const path = boundedString(value, 240, 1, field);
    if (!/^assets\/(?:[^/]+\/)*[^/]+\.png$/.test(path))
        fail('INVALID_INPUT', 'manifest.json', field);
    validateArchivePath(path, field);
    return path;
}
export function validateArchivePath(path, field) {
    if (!path || path.length > 240 || /[\\:\x00-\x1f\x7f<>"|?*]/.test(path) || path.startsWith('/'))
        fail('INVALID_PACKAGE', 'manifest.json', field);
    const parts = path.replace(/\/$/, '').split('/');
    if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)))
        fail('INVALID_PACKAGE', 'manifest.json', field);
}
export function validateSettingValue(setting, value) {
    switch (setting.type) {
        case 'text': return boundedString(value, setting.maxLength, setting.minLength);
        case 'enum':
            if (typeof value === 'string' && setting.options.includes(value))
                return value;
            break;
        case 'boolean':
            if (typeof value === 'boolean')
                return value;
            break;
        case 'number':
            if (typeof value === 'number' && Number.isFinite(value) && value >= setting.min && value <= setting.max)
                return value;
            break;
    }
    fail('INVALID_INPUT');
}
function unique(items, get) { const keys = items.map(get); if (new Set(keys).size !== keys.length)
    fail('INVALID_MANIFEST'); }
export function parseManifest(bytes, hostVersion) {
    if (bytes.byteLength > LIMITS.manifest)
        fail('INVALID_MANIFEST');
    try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        const m = record(parseStrictJson(text), ['manifestVersion', 'id', 'name', 'description', 'author', 'version', 'api', 'type', 'entry', 'requestedCapabilities', 'settings', 'pages', 'actions', 'assets']);
        if (m.manifestVersion !== 1)
            fail('INVALID_MANIFEST', 'manifest.json', 'manifestVersion');
        if (m.type !== 'declarative-manager')
            fail('INVALID_MANIFEST', 'manifest.json', 'type');
        if (!validPluginId(m.id))
            fail('INVALID_MANIFEST', 'manifest.json', 'id');
        boundedString(m.name, 80, 1, 'name');
        boundedString(m.description, 512, 0, 'description');
        versionParts(m.version, 'version');
        const author = record(m.author, ['name'], ['url'], 'author');
        boundedString(author.name, 128, 1, 'author.name');
        if (author.url !== undefined)
            httpsLiteral(author.url, 'author.url');
        const api = record(m.api, ['apiMajor', 'minHostVersion'], [], 'api');
        versionParts(api.minHostVersion, 'api.minHostVersion');
        if (api.apiMajor !== 1)
            fail('INCOMPATIBLE_PLUGIN', 'manifest.json', 'api.apiMajor');
        if (compareVersions(hostVersion, api.minHostVersion) < 0)
            fail('INCOMPATIBLE_PLUGIN', 'manifest.json', 'api.minHostVersion');
        const caps = array(m.requestedCapabilities, 128, 'requestedCapabilities');
        if (caps.some(cap => !PLUGIN_CAPABILITIES.includes(cap)) || new Set(caps).size !== caps.length || !caps.includes('manager.page'))
            fail('INVALID_MANIFEST', 'manifest.json', 'requestedCapabilities');
        const settings = array(m.settings, LIMITS.settings, 'settings').map(value => {
            const type = value?.type;
            const extra = type === 'text' ? ['minLength', 'maxLength'] : type === 'enum' ? ['options'] : type === 'number' ? ['min', 'max'] : type === 'boolean' ? [] : fail('INVALID_MANIFEST');
            const item = record(value, ['key', 'label', 'type', 'default', ...extra], [], 'settings');
            opaqueKey(item.key, 'settings.key');
            boundedString(item.label, 128, 1, 'settings.label');
            if (type === 'text' && (!Number.isInteger(item.minLength) || !Number.isInteger(item.maxLength) || Number(item.minLength) < 0 || Number(item.maxLength) > 50_000 || Number(item.minLength) > Number(item.maxLength)))
                fail('INVALID_MANIFEST');
            if (type === 'enum') {
                const options = array(item.options, 64);
                if (!options.length)
                    fail('INVALID_MANIFEST');
                for (const option of options)
                    boundedString(option, 128);
                unique(options, option => option);
            }
            if (type === 'number' && (typeof item.min !== 'number' || typeof item.max !== 'number' || !Number.isFinite(item.min) || !Number.isFinite(item.max) || item.min > item.max))
                fail('INVALID_MANIFEST');
            validateSettingValue(item, item.default);
            return item;
        });
        unique(settings, item => item.key);
        const assets = array(m.assets, LIMITS.entries - 1, 'assets').map(value => { const item = record(value, ['path', 'type'], [], 'assets'); safeAssetPath(item.path, 'assets.path'); if (item.type !== 'image/png')
            fail('INVALID_MANIFEST', 'manifest.json', 'assets.type'); return item; });
        unique(assets, item => item.path.normalize('NFC').toLowerCase());
        const entry = record(m.entry, ['pageId', 'label'], ['icon'], 'entry');
        opaqueKey(entry.pageId, 'entry.pageId');
        boundedString(entry.label, 80, 1, 'entry.label');
        if (entry.icon !== undefined && !assets.some(asset => asset.path === entry.icon))
            fail('INVALID_MANIFEST', 'manifest.json', 'entry.icon');
        const actions = array(m.actions, LIMITS.actions, 'actions').map(value => {
            const type = value?.type;
            if (typeof type !== 'string' || !caps.includes(type) || type === 'manager.page')
                fail('INVALID_MANIFEST');
            const keys = type.startsWith('plugin.') ? ['key'] : type === 'external.open' ? ['url'] : [];
            const item = record(value, ['id', 'type', ...keys], [], 'actions');
            opaqueKey(item.id, 'actions.id');
            if (keys.includes('key'))
                opaqueKey(item.key, 'actions.key');
            if (type.startsWith('plugin.config.') && !settings.some(setting => setting.key === item.key))
                fail('INVALID_MANIFEST', 'manifest.json', 'actions.key');
            if (type === 'external.open')
                httpsLiteral(item.url, 'actions.url');
            return item;
        });
        unique(actions, item => item.id);
        const pages = array(m.pages, LIMITS.pages, 'pages').map(value => {
            const page = record(value, ['id', 'title', 'blocks'], [], 'pages');
            opaqueKey(page.id, 'pages.id');
            boundedString(page.title, 128, 1, 'pages.title');
            for (const value of array(page.blocks, LIMITS.blocks, 'pages.blocks')) {
                const type = value?.type;
                switch (type) {
                    case 'heading':
                    case 'paragraph':
                        boundedString(record(value, ['type', 'text']).text, 4096, 0);
                        break;
                    case 'divider':
                        record(value, ['type']);
                        break;
                    case 'button': {
                        const block = record(value, ['type', 'label', 'actionId']);
                        boundedString(block.label, 128);
                        if (!actions.some(action => action.id === block.actionId))
                            fail('INVALID_MANIFEST');
                        break;
                    }
                    case 'text-input':
                    case 'select':
                    case 'checkbox': {
                        const block = record(value, ['type', 'settingKey']);
                        const setting = settings.find(setting => setting.key === block.settingKey);
                        if (!caps.includes('plugin.config.read') || !caps.includes('plugin.config.write') || !setting || setting.type !== ({ 'text-input': 'text', select: 'enum', checkbox: 'boolean' }[type]) || !actions.some(action => action.type === 'plugin.config.write' && action.key === setting.key))
                            fail('INVALID_MANIFEST');
                        break;
                    }
                    default: fail('INVALID_MANIFEST');
                }
            }
            return page;
        });
        unique(pages, page => page.id);
        if (!pages.some(page => page.id === entry.pageId))
            fail('INVALID_MANIFEST', 'manifest.json', 'entry.pageId');
        return m;
    }
    catch (error) {
        if (error instanceof PluginValidationError) {
            if (error.code === 'INCOMPATIBLE_PLUGIN')
                throw error;
            fail('INVALID_MANIFEST', error.path, error.field);
        }
        fail('INVALID_MANIFEST');
    }
}

export const LIMITS_V1 = LIMITS;
export const MANIFEST_VERSION_V1 = 1;
export const API_MAJOR_V1 = 1;
export const CAPABILITIES_V1 = PLUGIN_CAPABILITIES;
export const BLOCK_TYPES_V1 = Object.freeze(['heading', 'paragraph', 'text-input', 'select', 'checkbox', 'divider', 'button']);
export const ACTION_TYPES_V1 = Object.freeze(['plugin.config.read', 'plugin.config.write', 'plugin.storage.read', 'plugin.storage.write', 'external.open', 'clipboard.write', 'sharedAI.complete']);
export const parseManifestV1 = parseManifest;
export const parseStrictJsonV1 = parseStrictJson;
export const validateArchivePathV1 = validateArchivePath;
export const safeAssetPathV1 = safeAssetPath;
export const validPluginIdV1 = validPluginId;
export function crc32V1(bytes, seed = 0) { let crc = (seed ^ 0xffffffff) >>> 0; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; }
