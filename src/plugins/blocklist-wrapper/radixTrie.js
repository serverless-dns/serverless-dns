/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// impl based on S Hanov's succinct-trie: stevehanov.ca/blog/?id=120

import { TrieCache } from "./trie-cache.js";

const BASE64 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

const config = {
  debug: false,
  selectsearch: true,
  fastPos: true,
};

/**
 * The width of each unit of the encoding, in bits. Here we use 6, for base-64
 * encoding.
 */
const W = 16;

const bufferView = { 15: Uint16Array, 16: Uint16Array, 6: Uint8Array };

function chr16(ord) {
  return chrm(ord, false);
}

/**
 * Returns the character unit that represents the given value. If this were
 * binary data, we would simply return id.
 */
function chrm(ord, b64) {
  return b64 ? BASE64[ord] : String.fromCharCode(ord);
}

/**
 * Returns the decimal value of the given character unit.
 */
const ORD = {};

for (let i = 0; i < BASE64.length; i++) {
  ORD[BASE64[i]] = i;
}

function dec16(chr) {
  return decm(chr, false);
}

function decm(chr, b64) {
  return b64 ? ORD[chr] : chr.charCodeAt(0);
}

/**
 * Fixed values for the L1 and L2 table sizes in the Rank Directory
 */
const L1 = 32 * 32;
const L2 = 32;

const TxtEnc = new TextEncoder();
const TxtDec = new TextDecoder();
// DELIM to tag elements in the trie, shouldn't be a valid base32 char
const DELIM = "#";
// utf8 encoded delim for non-base32/64
const ENC_DELIM = TxtEnc.encode(DELIM);

// period encode value for wildcard lookup
const periodEncVal = TxtEnc.encode(".");

/**
 * Given a string of data (eg, in BASE-64), the BitString class supports
 * reading or counting a number of bits from an arbitrary position in the
 * string.
 */
function BitString(str) {
  this.init(str);
}

BitString.MaskTop = {
  16: [
    0xffff, 0x7fff, 0x3fff, 0x1fff, 0x0fff, 0x07ff, 0x03ff, 0x01ff, 0x00ff,
    0x007f, 0x003f, 0x001f, 0x000f, 0x0007, 0x0003, 0x0001, 0x0000,
  ],
};

BitString.MaskBottom = {
  16: [
    0xffff, 0xfffe, 0xfffc, 0xfff8, 0xfff0, 0xffe0, 0xffc0, 0xff80, 0xff00,
    0xfe00, 0xfc00, 0xf800, 0xf000, 0xe000, 0xc000, 0x8000, 0x0000,
  ],
};

const BitsSetTable256 = [];

// Function to initialise the lookup table
function initialize() {
  BitsSetTable256[0] = 0;
  for (let i = 0; i < 256; i++) {
    BitsSetTable256[i] = (i & 1) + BitsSetTable256[Math.floor(i / 2)];
  }
}

// Function to return the count
// of set bits in n
function countSetBits(n) {
  return (
    BitsSetTable256[n & 0xff] +
    BitsSetTable256[(n >>> 8) & 0xff] +
    BitsSetTable256[(n >>> 16) & 0xff] +
    BitsSetTable256[n >>> 24]
  );
}

function bit0(n, p, pad) {
  const r = bit0p(n, p);
  if (r.scanned <= 0) return r.scanned; // r.index
  if (r.index > 0) return r.scanned; // r.index
  // FIXME: The following should instead be (also see #bit0p)
  // if (pad <= r.index) return r.index
  // else error("p-th zero-bit lies is outside of pad+n")
  // The line below works because p is only ever equal to 1
  if (pad > r.scanned) return r.scanned + 1;
  else return 0;
}

/**
 * Find the pth zero bit in the number, n.
 * @param {*} n The number, which is usually unsigned 32-bits
 * @param {*} p The pth zero bit
 */
function bit0p(n, p) {
  // capture m for debug purposes
  const m = n;

  // 0th zero-bit doesn't exist (nb: valid index begins at 1)
  if (p === 0) return { index: 0, scanned: 0 };
  // when n = 0, 1st zero-bit is at index 1
  if (n === 0 && p === 1) return { index: 1, scanned: 1 };
  let c = 0;
  let i = 0;
  // iterate until either n is 0 or we've counted 'p' zero-bits
  while (n > 0 && p > c) {
    // increment c when n-th lsb-bit is 0
    c = c + (n < (n ^ 0x1)) ? 1 : 0;
    // total bits in 'n' scanned thus far
    i += 1;
    // next lsb-bit in 'n'
    n = n >>> 1;
  }
  if (config.debug) {
    console.log(String.fromCharCode(m).charCodeAt(0).toString(2), m, i, p, c);
  }
  // if 'p' zero-bits are accounted for, then 'i' is the p-th zero-bit in 'n'
  // FIXME: instead return: { index: i + (p - c), scanned: i }? see: #bit0
  return { index: p === c ? i : 0, scanned: i };
}

BitString.prototype = {
  init: function (str) {
    this.bytes = str;
    this.length = this.bytes.length * W;
  },

  /**
   * Returns the internal string of bytes
   */
  getData: function () {
    return this.bytes;
  },

  /**
   * Return an array of decimal values, one for every n bits.
   */
  encode: function (n) {
    const e = [];
    for (let i = 0; i < this.length; i += n) {
      e.push(this.get(i, Math.min(this.length, n)));
    }
    return e;
  },

  /**
   * Returns a decimal number, consisting of a certain number of bits (n)
   * starting at a certain position, p.
   */
  get: function (p, n) {
    // supports n <= 31, since js bitwise operations work only on +ve ints

    // case 1: bits lie within the given byte
    if ((p % W) + n <= W) {
      return (
        (this.bytes[(p / W) | 0] & BitString.MaskTop[W][p % W]) >>
        (W - (p % W) - n)
      );
    } else {
      // case 2: bits lie incompletely in the given byte
      let result = this.bytes[(p / W) | 0] & BitString.MaskTop[W][p % W];

      const l = W - (p % W);
      p += l;
      n -= l;

      while (n >= W) {
        result = (result << W) | this.bytes[(p / W) | 0];
        p += W;
        n -= W;
      }
      if (n > 0) {
        result = (result << n) | (this.bytes[(p / W) | 0] >> (W - n));
      }

      return result;
    }
  },

  /**
   * Counts the number of bits set to 1 starting at position p and
   * ending at position p + n
   */
  count: function (p, n) {
    let count = 0;
    while (n >= 16) {
      count += BitsSetTable256[this.get(p, 16)];
      p += 16;
      n -= 16;
    }

    return count + BitsSetTable256[this.get(p, n)];
  },

  /**
   * Returns the index of the nth 0, starting at position i.
   */
  pos0: function (i, n) {
    if (n < 0) return 0;
    let step = 16;
    let index = i;

    if (!config.fastPos) {
      while (n > 0) {
        step = n <= 16 ? n : 16;
        const bits0 = step - countSetBits(this.get(i, step));
        if (config.debug) {
          console.log(i, ":i|step:", step, "get:", this.get(i, step), "n:", n);
        }
        n -= bits0;
        i += step;
        index = i - 1;
      }
      return index;
    }

    while (n > 0) {
      const d = this.get(i, step);
      const bits0 = step - countSetBits(d);
      if (config.debug) {
        console.log(i, ":i|step:", step, "get:", this.get(i, step), "n:", n);
      }

      if (n - bits0 < 0) {
        step = Math.max(n, (step / 2) | 0);
        continue;
      }
      n -= bits0;
      i += step;
      const diff = n === 0 ? bit0(d, 1, step) : 1;
      index = i - diff; // 1;
    }

    return index;
  },

  /**
   * Returns the number of bits set to 1 up to and including position x.
   * This is the slow implementation used for testing.
   */
  rank: function (x) {
    let rank = 0;
    for (let i = 0; i <= x; i++) {
      if (this.get(i, 1)) {
        rank++;
      }
    }

    return rank;
  },
};

/**
 * The rank directory allows you to build an index to quickly compute the
 * rank() and select() functions. The index can itself be encoded as a binary
 * string.
 */
function RankDirectory(directoryData, bitData, numBits, l1Size, l2Size) {
  this.init(directoryData, bitData, numBits, l1Size, l2Size);
}

RankDirectory.prototype = {
  init: function (directoryData, trieData, numBits, l1Size, l2Size) {
    this.directory = new BitString(directoryData);
    this.data = new BitString(trieData);
    this.l1Size = l1Size;
    this.l2Size = l2Size;
    this.l1Bits = Math.ceil(Math.log2(numBits));
    this.l2Bits = Math.ceil(Math.log2(l1Size));
    this.sectionBits = (l1Size / l2Size - 1) * this.l2Bits + this.l1Bits;
    this.numBits = numBits;
  },

  /**
   * Returns the string representation of the directory.
   */
  getData: function () {
    return this.directory.getData();
  },

  /**
   * Returns the number of 1 or 0 bits (depending on the "which" parameter) to
   * to and including position x.
   */
  rank: function (which, x) {
    // fixme: selectsearch doesn't work when which === 1, throw error?
    // or, impl a proper O(1) select instead of the current gross hack.
    if (config.selectsearch) {
      let rank = -1;
      let sectionPos = 0;
      if (x >= this.l2Size) {
        sectionPos = ((x / this.l2Size) | 0) * this.l1Bits;
        rank = this.directory.get(sectionPos - this.l1Bits, this.l1Bits);
        x = x % this.l2Size;
      }
      const ans = x > 0 ? this.data.pos0(rank + 1, x) : rank;
      if (config.debug) {
        console.log("ans:", ans, rank, ":r, x:", x, "s:", sectionPos);
      }
      return ans;
    }

    if (which === 0) {
      return x - this.rank(1, x) + 1;
    }

    let rank = 0;
    let o = x;
    let sectionPos = 0;

    if (o >= this.l1Size) {
      sectionPos = ((o / this.l1Size) | 0) * this.sectionBits;
      rank = this.directory.get(sectionPos - this.l1Bits, this.l1Bits);
      if (config.debug) {
        console.log("o: " + rank + " sec: " + sectionPos);
      }
      o = o % this.l1Size;
    }

    if (o >= this.l2Size) {
      sectionPos += ((o / this.l2Size) | 0) * this.l2Bits;
      rank += this.directory.get(sectionPos - this.l2Bits, this.l2Bits);
      if (config.debug) {
        console.log("o2: " + rank + " sec: " + sectionPos);
      }
    }

    rank += this.data.count(x - (x % this.l2Size), (x % this.l2Size) + 1);

    if (config.debug) {
      console.log("ans:", rank, "x:", o, "s:", sectionPos, "o:", x);
    }

    return rank;
  },

  /**
   * Returns the position of the y'th 0 or 1 bit, depending on the "which"
   * parameter.
   */
  select: function (which, y) {
    let high = this.numBits;
    let low = -1;
    let val = -1;

    // todo: assert y less than numBits
    if (config.selectsearch) {
      return this.rank(0, y);
    }

    while (high - low > 1) {
      const probe = ((high + low) / 2) | 0;
      const r = this.rank(which, probe);

      if (r === y) {
        // We have to continue searching after we have found it,
        // because we want the _first_ occurrence.
        val = probe;
        high = probe;
      } else if (r < y) {
        low = probe;
      } else {
        high = probe;
      }
    }

    return val;
  },
};

function Tags(flags) {
  this.init();
  this.setupFlags(flags);
}

Tags.prototype = {
  init: function (flags) {
    this.flags = {};
    this.rflags = {};
    this.fsize = 0;
  },

  setupFlags: function (flags) {
    let i = 0;
    for (const f of flags) {
      this.flags[f] = i++;
    }
    this.rflags = flags;
    // controls number of 16-bit sloted storage for a final trie-node flag.
    // The +1 is reserved for a 16-bit header. This val must be >=2 and <=16.
    this.fsize = Math.ceil(Math.log2(flags.length) / 16) + 1;
  },

  flagsToTag: function (flags) {
    // flags has to be an array of 16-bit integers.
    const header = flags[0];
    const tagIndices = [];
    const values = [];
    for (let i = 0, mask = 0x8000; i < 16; i++) {
      if (header << i === 0) break;
      if ((header & mask) === mask) {
        tagIndices.push(i);
      }
      mask = mask >>> 1;
    }
    // flags.length must be equal to tagIndices.length
    if (tagIndices.length !== flags.length - 1) {
      console.log(tagIndices, flags, "flags/header mismatch (upsert bug?)");
      return values;
    }
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i + 1];
      const index = tagIndices[i];
      for (let j = 0, mask = 0x8000; j < 16; j++) {
        if (flag << j === 0) break;
        if ((flag & mask) === mask) {
          const pos = index * 16 + j;
          if (config.debug) {
            console.log("pos", pos, "i/ti", index, tagIndices, "j/i", j, i);
          }
          values.push(this.rflags[pos]);
        }
        mask = mask >>> 1;
      }
    }
    return values;
  },
};

/**
 * This class is used for traversing the succinctly encoded trie.
 */
function FrozenTrieNode(trie, index) {
  // retrieve the 7-bit/6-bit letter.
  let finCached;
  let whCached;
  let comCached;
  let fcCached;
  let chCached;
  let valCached;
  let flagCached;
  let wordCached;
  let cursorCached;

  this.trie = trie;
  this.index = index;

  this.final = () => {
    if (typeof finCached === "undefined") {
      // final node is 0x1ii => 0001 iiii iiii
      // where iiii iiii is utf-8 encoded letter()
      // a final-node never sets compressed-flag; if it does, it's a value-node
      // github.com/serverless-dns/blocklists/blob/c858b3a0/trie.js#L1018-L1032
      const extrabits = this.trie.extraBit;
      const bitsize = 1; // size of the final bit
      finCached =
        this.trie.data.get(
          this.trie.letterStart + index * this.trie.bitslen + extrabits,
          bitsize
        ) === 1;
    }
    return finCached;
  };

  this.where = () => {
    if (typeof whCached === "undefined") {
      // bits for node-headers that are 2-bit wide per trie-node (used to diff
      // between none/final/value/compressed node-types) should be skipped
      // ie, a letter is 0bxxhhhhllll, where xx are the 2-bit node-header
      const extrabits = 1 + this.trie.extraBit;
      whCached = this.trie.data.get(
        this.trie.letterStart + index * this.trie.bitslen + extrabits,
        this.trie.bitslen - extrabits
      );
    }
    return whCached;
  };

  this.compressed = () => {
    // compressed-node is of form 0x2ii => 0010 iiii iiii
    const bitsize = 1;
    if (typeof comCached === "undefined") {
      comCached =
        this.trie.data.get(
          this.trie.letterStart + index * this.trie.bitslen,
          bitsize
        ) === 1;
    }
    return comCached;
  };

  this.flag = () => {
    // flag-node is of form 0x3ii => 0011 iiii iiii;
    // that is, both compressed and final bits are set
    if (typeof flagCached === "undefined") {
      flagCached = this.compressed() && this.final();
    }
    return flagCached;
  };

  this.letter = () => this.where();

  this.radix = (parent, cachecursor = null) => {
    if (typeof wordCached !== "undefined") return [wordCached, cursorCached];

    // location of this child among all other children of its parent
    const loc = this.index - parent.firstChild();
    // todo: check for index less than letterStart?
    const prev = loc > 0 ? parent.getChild(loc - 1) : null;
    const isPrevNodeCompressed = prev && prev.compressed() && !prev.flag();
    const isThisNodeCompressed = this.compressed() && !this.flag();

    if (isThisNodeCompressed || isPrevNodeCompressed) {
      const cc = this.trie.nodecache.find(this.index, cachecursor);
      if (cc != null && cc.value != null) {
        wordCached = cc.value;
        cursorCached = cc.cursor;
        if (config.debug) console.log("\t\t\tnode-c-hit", this.index);
        return [wordCached, cursorCached];
      }

      if (config.debug) console.log("\t\t\tnode-c-miss, add:", this.index);

      const startchild = [];
      const endchild = [];
      let start = 0;
      let end = 0;

      startchild.push(this);
      start += 1;

      // startchild len > word len terminate
      // fixme: startchild first letter != w first letter terminate
      do {
        const temp = parent.getChild(loc - start);
        if (!temp.compressed()) break;
        if (temp.flag()) break;
        startchild.push(temp);
        start += 1;
      } while (true);

      // if the child itself the last-node in the sequence, nothing
      // to do, there's no endchild to track; but otherwise, loop:
      if (isThisNodeCompressed) {
        do {
          end += 1;
          const temp = parent.getChild(loc + end);
          endchild.push(temp);
          if (!temp.compressed()) break;
          // would not encounter a flag-node whilst probing higher indices
          // as flag-nodes are rooted at 0..upto first letter-node
        } while (true);
      }
      const nodes = startchild.reverse().concat(endchild);
      const w = nodes.map((n) => n.letter());
      // start index of this compressed node in the overall trie
      const lo = this.index - start + 1;
      // end index of this compressed node in the overall trie
      const hi = this.index + end;
      wordCached = {
        // the entire word represented by this compressed-node as utf8 uints
        word: w,
        // start-index of this compressed-node in its parent
        loc: lo - parent.firstChild(),
        // the last node contains refs to all children of this compressed-node
        branch: nodes[nodes.length - 1],
      };
      // cache compressed-nodes against their trie indices (spawn)
      this.trie.nodecache.put(lo, hi, wordCached);
    } else {
      wordCached = {
        word: [this.letter()],
        loc: loc,
        branch: this,
      };
    }

    return [wordCached, cursorCached || null];
  };

  this.firstChild = () => {
    if (!fcCached) fcCached = this.trie.directory.select(0, index + 1) - index;
    return fcCached;
  };

  this.childOfNextNode = () => {
    if (!chCached) {
      chCached = this.trie.directory.select(0, index + 2) - index - 1;
    }
    return chCached;
  };

  this.childCount = () => this.childOfNextNode() - this.firstChild();

  this.value = () => {
    if (typeof valCached === "undefined") {
      const value = [];
      let i = 0;
      let j = 0;
      if (config.debug) {
        console.log("cur:i/l/c", this.index, this.letter(), this.childCount());
      }
      while (i < this.childCount()) {
        const valueChain = this.getChild(i);
        if (config.debug) {
          console.log("vc no-flag end i/l", i, valueChain.letter());
          console.log("f/idx/v", valueChain.flag(), valueChain.index, value);
        }
        if (!valueChain.flag()) {
          break;
        }
        if (i % 2 === 0) {
          value.push(valueChain.letter() << 8);
        } else {
          value[j] = value[j] | valueChain.letter();
          j += 1;
        }
        i += 1;
      }
      valCached = value;
    }

    return valCached;
  };

  if (config.debug) {
    console.log(index, ":i, fc:", this.firstChild(), "tl:", this.letter());
    console.log("c:", this.compressed(), "f:", this.final());
    console.log("wh:", this.where(), "flag:", this.flag());
  }
}

FrozenTrieNode.prototype = {
  /**
   * Returns the number of children.
   */
  getChildCount: function () {
    return this.childCount();
  },

  /**
   * Returns the FrozenTrieNode for the given child.
   * @param {*} index The 0-based index of the child of this node.
   * For example, if the node has 5 children, and you wanted the 0th one,
   * pass in 0.
   * @returns
   */
  getChild: function (index) {
    return this.trie.getNodeByIndex(this.firstChild() + index);
  },

  lastFlagChild: function () {
    const childcount = this.getChildCount();

    let i = 0;
    // value-nodes (starting at position 0) preceed all their other
    // siblings. That is, in a node{f1, f2, ..., fn, l1, l2 ...},
    // f1..fn are flags (value-nodes), then letter nodes l1..ln follow
    while (i < childcount) {
      const c = this.getChild(i);
      // value-node (flag) ended at prev index
      if (!c.flag()) return i - 1;
      i += 1;
    }

    // likely all children nodes are flags (value-nodes)
    return i;
  },
};

/**
 * The FrozenTrie is used for looking up words in the encoded trie.
 * @param {*} data A string representing the encoded trie.
 * @param {*} directoryData A string representing the RankDirectory.
 * The global L1 and L2 constants are used to determine the L1Size and L2size.
 * @param {*} nodeCount The number of nodes in the trie.
 */
function FrozenTrie(data, rdir, nodeCount) {
  this.init(data, rdir, nodeCount);
}

FrozenTrie.prototype = {
  init: function (trieData, rdir, nodeCount) {
    this.data = new BitString(trieData);
    // pass the rank directory instead of data
    this.directory = rdir;

    this.extraBit = 1;
    this.bitslen = 9 + this.extraBit;

    // The position of the first bit of the data in 0th node. In non-root
    // nodes, this would contain bitslen letters.
    this.letterStart = nodeCount * 2 + 1;

    this.nodecache = new TrieCache();
  },

  /**
   * Retrieve the FrozenTrieNode of the trie, given its index in level-order.
   */
  getNodeByIndex: function (index) {
    return new FrozenTrieNode(this, index);
  },

  /**
   * Retrieve the root node. You can use this node to obtain all of the other
   * nodes in the trie.
   */
  getRoot: function () {
    return this.getNodeByIndex(0);
  },

  /**
   * Look-up a word in the trie. Returns true if and only if the word exists
   * in the trie.
   */
  lookup: function (word) {
    const debug = config.debug;

    const index = word.lastIndexOf(ENC_DELIM[0]);
    if (index > 0) word = word.slice(0, index);

    // cursor tracks position of previous cache-hit in frozentrie:nodecache
    let cachecursor = null;
    // the output of this fn
    let returnValue = false;
    // the current trie node to query
    let node = this.getRoot();
    // index in the incoming word utf-8 array
    let i = 0;
    while (i < word.length) {
      if (node == null) {
        if (debug) console.log("...no more nodes, lookup complete");
        return returnValue;
      }

      // if '.' is encountered, capture the interim node.value();
      // for ex: s.d.com => return values for com. & com.d. & com.d.s
      if (periodEncVal[0] === word[i] && node.final()) {
        if (!returnValue) returnValue = new Map();
        const partial = TxtDec.decode(word.slice(0, i).reverse());
        returnValue.set(partial, node.value());
      }

      const lastFlagNodeIndex = node.lastFlagChild();
      if (debug) {
        console.log("count/i/w:", node.getChildCount(), i, word[i]);
        console.log("node-w:", node.letter(), "flag-at:", lastFlagNodeIndex);
      }

      // iff flags (value-node) exist but no other children, terminate lookup
      // ie: in child{f1, f2, ..., fn}; all children are flags (value-nodes)
      if (lastFlagNodeIndex >= node.getChildCount() - 1) {
        if (debug) console.log("...no more children, rem:", word.slice(i));
        return returnValue;
      }

      let high = node.getChildCount();
      let low = lastFlagNodeIndex;
      let next = null;

      while (high - low > 1) {
        const probe = ((high + low) / 2) | 0;
        const child = node.getChild(probe);
        const [r, cc] = child.radix(node, cachecursor);
        const comp = r.word;
        const w = word.slice(i, i + comp.length);

        if (debug) {
          console.log("\t\tl/h:", low, high, "p:", probe, "s:", comp, "w:", w);
          const pr = cachecursor && cachecursor.range;
          const nr = cc && cc.range;
          if (cc) console.log("index", child.index, "now:cc", nr, "p:cc", pr);
        }

        cachecursor = cc != null ? cc : cachecursor;

        if (comp[0] > w[0]) {
          // binary search the lower half of the trie
          high = r.loc;
          if (debug) console.log("\t\tnew h", high, comp[0], ">", w[0]);
          continue;
        } else if (comp[0] < w[0]) {
          // binary search the upper half of the trie beyond r.word
          low = r.loc + comp.length - 1;
          if (debug) console.log("\t\tnew l", low, comp[0], "<", w[0]);
          continue;
        } // else, comp[0] === w[0] and so, match up the rest of comp

        // if word length is less than current node length, no match
        // for ex, if word="abcd" and cur-node="abcdef", then bail
        if (w.length < comp.length) return returnValue;
        for (let u = 0; u < comp.length; u++) {
          // bail on mismatch, ex word="axyz" and cur-node="axxx"
          if (w[u] !== comp[u]) return returnValue;
        }

        if (debug) console.log("\t\tit:", probe, "r", r.loc, "break");

        // final child of a compressed-node has refs to all its children
        next = r.branch;
        // move ahead to now compare rest of the letters in word[i:length]
        i += w.length;
        break;
      }

      if (debug) console.log("\tnext:", next && next.letter());
      node = next; // next is null when no match is found
    }

    // the entire word to be looked-up has been iterated over, see if
    // we are on a final-node to know if we've got a match in the trie
    if (node.final()) {
      if (!returnValue) returnValue = new Map();
      returnValue.set(TxtDec.decode(word.reverse()), node.value());
    }

    if (debug) console.log("...lookup complete:", returnValue);

    // fixme: see above re returning "false" vs [false] vs [[0], false]
    return returnValue;
  },
};

export function customTagToFlag(fl, blocklistFileTag) {
  let res = chr16(0);
  for (const flag of fl) {
    const val = blocklistFileTag[flag].value;
    const header = 0;
    const index = (val / 16) | 0; // + 1;
    const pos = val % 16;
    let h = 0;
    h = dec16(res[header]);

    const dataIndex =
      countSetBits(h & BitString.MaskBottom[16][16 - index]) + 1;
    let n = ((h >>> (15 - index)) & 0x1) !== 1 ? 0 : dec16(res[dataIndex]);
    const upsertData = n !== 0;
    h |= 1 << (15 - index);
    n |= 1 << (15 - pos);
    res =
      chr16(h) +
      res.slice(1, dataIndex) +
      chr16(n) +
      res.slice(upsertData ? dataIndex + 1 : dataIndex);
  }
  return res;
}

export function createTrie(
  tdbuf,
  rdbuf,
  blocklistFileTag,
  blocklistBasicConfig
) {
  initialize();
  const tag = {};
  const fl = [];
  for (const fileuname in blocklistFileTag) {
    if (!blocklistFileTag.hasOwnProperty(fileuname)) continue;
    fl[blocklistFileTag[fileuname].value] = fileuname;
    // reverse the value since it is prepended to
    // the front of key when not encoded with base32
    const v = DELIM + blocklistFileTag[fileuname].uname;
    tag[fileuname] = v.split("").reverse().join("");
  }

  // tdbuf, rdbuf must be untyped arraybuffers on all platforms
  // bufutil.concat, as one example, creates untyped arraybuffer,
  // as does nodejs' Buffer module. If what's passed is a typedarray,
  // then bufferView would not work as expected. For example,
  // tdbuf is Uint8Array([0x00, 0xff, 0xf3, 0x00]), then
  // tdv is Uint16Array([0x00, 0xff, 0xff, 0x00]), but
  // the expectation is that tdv is a "view" and not a copy of uint8
  // that is, tdv must instead be Uint16Array([0xff00, 0x00f3])
  const tags = new Tags(fl);
  const tdv = new bufferView[W](tdbuf);
  const rdv = new bufferView[W](rdbuf);
  const nc = blocklistBasicConfig.nodecount;
  const numbits = blocklistBasicConfig.nodecount * 2 + 1;
  const rd = new RankDirectory(rdv, tdv, numbits, L1, L2);
  const frozentrie = new FrozenTrie(tdv, rd, nc);

  return { t: tags, ft: frozentrie };
}
