module.exports = (function() {
var __MODS__ = {};
var __DEFINE__ = function(modId, func, req) { var m = { exports: {}, _tempexports: {} }; __MODS__[modId] = { status: 0, func: func, req: req, m: m }; };
var __REQUIRE__ = function(modId, source) { if(!__MODS__[modId]) return require(source); if(!__MODS__[modId].status) { var m = __MODS__[modId].m; m._exports = m._tempexports; var desp = Object.getOwnPropertyDescriptor(m, "exports"); if (desp && desp.configurable) Object.defineProperty(m, "exports", { set: function (val) { if(typeof val === "object" && val !== m._exports) { m._exports.__proto__ = val.__proto__; Object.keys(val).forEach(function (k) { m._exports[k] = val[k]; }); } m._tempexports = val }, get: function () { return m._tempexports; } }); __MODS__[modId].status = 1; __MODS__[modId].func(__MODS__[modId].req, m, m.exports); } return __MODS__[modId].m.exports; };
var __REQUIRE_WILDCARD__ = function(obj) { if(obj && obj.__esModule) { return obj; } else { var newObj = {}; if(obj != null) { for(var k in obj) { if (Object.prototype.hasOwnProperty.call(obj, k)) newObj[k] = obj[k]; } } newObj.default = obj; return newObj; } };
var __REQUIRE_DEFAULT__ = function(obj) { return obj && obj.__esModule ? obj.default : obj; };
__DEFINE__(1764332932866, function(require, module, exports) {

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const index_1 = __importDefault(require("./index"));
const memory_code_points_1 = require("./memory-code-points");
const code_points_data_1 = __importDefault(require("./code-points-data"));
const codePoints = (0, memory_code_points_1.createMemoryCodePoints)(code_points_data_1.default);
function saslprep(input, opts) {
    return (0, index_1.default)(codePoints, input, opts);
}
saslprep.saslprep = saslprep;
saslprep.default = saslprep;
module.exports = saslprep;
//# sourceMappingURL=node.js.map
}, function(modId) {var map = {"./index":1764332932867,"./memory-code-points":1764332932868,"./code-points-data":1764332932869}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1764332932867, function(require, module, exports) {

const getCodePoint = (character) => character.codePointAt(0);
const first = (x) => x[0];
const last = (x) => x[x.length - 1];
function toCodePoints(input) {
    const codepoints = [];
    const size = input.length;
    for (let i = 0; i < size; i += 1) {
        const before = input.charCodeAt(i);
        if (before >= 0xd800 && before <= 0xdbff && size > i + 1) {
            const next = input.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                codepoints.push((before - 0xd800) * 0x400 + next - 0xdc00 + 0x10000);
                i += 1;
                continue;
            }
        }
        codepoints.push(before);
    }
    return codepoints;
}
function saslprep({ unassigned_code_points, commonly_mapped_to_nothing, non_ASCII_space_characters, prohibited_characters, bidirectional_r_al, bidirectional_l, }, input, opts = {}) {
    const mapping2space = non_ASCII_space_characters;
    const mapping2nothing = commonly_mapped_to_nothing;
    if (typeof input !== 'string') {
        throw new TypeError('Expected string.');
    }
    if (input.length === 0) {
        return '';
    }
    const mapped_input = toCodePoints(input)
        .map((character) => (mapping2space.get(character) ? 0x20 : character))
        .filter((character) => !mapping2nothing.get(character));
    const normalized_input = String.fromCodePoint
        .apply(null, mapped_input)
        .normalize('NFKC');
    const normalized_map = toCodePoints(normalized_input);
    const hasProhibited = normalized_map.some((character) => prohibited_characters.get(character));
    if (hasProhibited) {
        throw new Error('Prohibited character, see https://tools.ietf.org/html/rfc4013#section-2.3');
    }
    if (opts.allowUnassigned !== true) {
        const hasUnassigned = normalized_map.some((character) => unassigned_code_points.get(character));
        if (hasUnassigned) {
            throw new Error('Unassigned code point, see https://tools.ietf.org/html/rfc4013#section-2.5');
        }
    }
    const hasBidiRAL = normalized_map.some((character) => bidirectional_r_al.get(character));
    const hasBidiL = normalized_map.some((character) => bidirectional_l.get(character));
    if (hasBidiRAL && hasBidiL) {
        throw new Error('String must not contain RandALCat and LCat at the same time,' +
            ' see https://tools.ietf.org/html/rfc3454#section-6');
    }
    const isFirstBidiRAL = bidirectional_r_al.get(getCodePoint(first(normalized_input)));
    const isLastBidiRAL = bidirectional_r_al.get(getCodePoint(last(normalized_input)));
    if (hasBidiRAL && !(isFirstBidiRAL && isLastBidiRAL)) {
        throw new Error('Bidirectional RandALCat character must be the first and the last' +
            ' character of the string, see https://tools.ietf.org/html/rfc3454#section-6');
    }
    return normalized_input;
}
saslprep.saslprep = saslprep;
saslprep.default = saslprep;
module.exports = saslprep;
//# sourceMappingURL=index.js.map
}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1764332932868, function(require, module, exports) {

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMemoryCodePoints = createMemoryCodePoints;
const sparse_bitfield_1 = __importDefault(require("sparse-bitfield"));
function createMemoryCodePoints(data) {
    let offset = 0;
    function read() {
        const size = data.readUInt32BE(offset);
        offset += 4;
        const codepoints = data.slice(offset, offset + size);
        offset += size;
        return (0, sparse_bitfield_1.default)({ buffer: codepoints });
    }
    const unassigned_code_points = read();
    const commonly_mapped_to_nothing = read();
    const non_ASCII_space_characters = read();
    const prohibited_characters = read();
    const bidirectional_r_al = read();
    const bidirectional_l = read();
    return {
        unassigned_code_points,
        commonly_mapped_to_nothing,
        non_ASCII_space_characters,
        prohibited_characters,
        bidirectional_r_al,
        bidirectional_l,
    };
}
//# sourceMappingURL=memory-code-points.js.map
}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
__DEFINE__(1764332932869, function(require, module, exports) {

Object.defineProperty(exports, "__esModule", { value: true });
const zlib_1 = require("zlib");
exports.default = (0, zlib_1.gunzipSync)(Buffer.from('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', 'base64'));
//# sourceMappingURL=code-points-data.js.map
}, function(modId) { var map = {}; return __REQUIRE__(map[modId], modId); })
return __REQUIRE__(1764332932866);
})()
//miniprogram-npm-outsideDeps=["sparse-bitfield","zlib"]
//# sourceMappingURL=index.js.map