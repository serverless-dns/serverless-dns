/*
 * Copyright (c) 2020 RethinkDNS and its authors.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// impl based on S Hanov's succinct-trie: stevehanov.ca/blog/?id=120

const BASE64 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";

const config = {
  useBinarySearch: true,
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

function CHR(ord) {
  return CHRM(ord, W === 6);
}

function CHR16(ord) {
  return CHRM(ord, false);
}

/**
 * Returns the character unit that represents the given value. If this were
 * binary data, we would simply return id.
 */
function CHRM(ord, b64) {
  return (b64) ? BASE64[ord] : String.fromCharCode(ord);
}

/**
 * Returns the decimal value of the given character unit.
 */
const ORD = {};

for (let i = 0; i < BASE64.length; i++) {
  ORD[BASE64[i]] = i;
}

function DEC(chr) {
  return DECM(chr, W === 6);
}

function DEC16(chr) {
  return DECM(chr, false);
}

function DECM(chr, b64) {
  return (b64) ? ORD[chr] : chr.charCodeAt(0);
}

/**
 * Fixed values for the L1 and L2 table sizes in the Rank Directory
 */
const L1 = 32 * 32;
const L2 = 32;
// bits per meta-data field stored with trie-encode
const MFIELDBITS = 30;
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
    0xffff,
    0x7fff,
    0x3fff,
    0x1fff,
    0x0fff,
    0x07ff,
    0x03ff,
    0x01ff,
    0x00ff,
    0x007f,
    0x003f,
    0x001f,
    0x000f,
    0x0007,
    0x0003,
    0x0001,
    0x0000,
  ],
};

BitString.MaskBottom = {
  16: [
    0xffff,
    0xfffe,
    0xfffc,
    0xfff8,
    0xfff0,
    0xffe0,
    0xffc0,
    0xff80,
    0xff00,
    0xfe00,
    0xfc00,
    0xf800,
    0xf000,
    0xe000,
    0xc000,
    0x8000,
    0x0000,
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
  return (BitsSetTable256[n & 0xff] +
    BitsSetTable256[(n >>> 8) & 0xff] +
    BitsSetTable256[(n >>> 16) & 0xff] +
    BitsSetTable256[n >>> 24]);
}

function bit0(n, p, pad) {
  const r = bit0p(n, p);
  if (r.scanned <= 0) return r.scanned; // r.index
  if (r.index > 0) return r.scanned; // r.index
  if (pad > r.scanned) return r.scanned + 1; // + 1
  else return 0;
}

/**
 * Find the pth zero bit in the number, n.
 * @param {*} n The number, which is usually unsigned 32-bits
 * @param {*} p The pth zero bit
 */
function bit0p(n, p) {
  if (p == 0) return { index: 0, scanned: 0 };
  if (n == 0 && p == 1) return { index: 1, scanned: 1 };
  let c = 0, i = 0, m = n;
  for (c = 0; n > 0 && p > c; n = n >>> 1) {
    // increment c when nth lsb (bit) is 0
    c = c + (n < (n ^ 0x1)) ? 1 : 0;
    i += 1;
  }
  //console.log("      ", String.fromCharCode(m).charCodeAt(0).toString(2), m, i, p, c);
  return { index: (p == c) ? i : 0, scanned: i };
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
  get: function (p, n, debug = false) {
    // supports n <= 31, since bitwise operations works only on +ve integers in js

    // case 1: bits lie within the given byte
    if ((p % W) + n <= W) {
      return (this.bytes[p / W | 0] & BitString.MaskTop[W][p % W]) >>
        (W - (p % W) - n);

      // case 2: bits lie incompletely in the given byte
    } else {
      let result = (this.bytes[p / W | 0] & BitString.MaskTop[W][p % W]);
      let tmpCount = 0; //santhosh added
      const disp1 = this.bytes[p / W | 0];
      const disp2 = BitString.MaskTop[W][p % W];
      const res1 = result;
      const l = W - p % W;
      p += l;
      n -= l;

      while (n >= W) {
        tmpCount++;
        result = (result << W) | this.bytes[p / W | 0];
        p += W;
        n -= W;
      }
      const res2 = result;
      if (n > 0) {
        result = (result << n) | (this.bytes[p / W | 0] >> (W - n));
      }

      if (debug == true) {
        console.log(
          "disp1: " + disp1 + " disp2: " + disp2 + " loopcount: " + tmpCount +
            " res1: " + res1 + " res2: " + res2 + " r: " + result,
        );
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

    if (config.fastPos === false) {
      while (n > 0) {
        step = (n <= 16) ? n : 16;
        const bits0 = step - countSetBits(this.get(i, step));
        //console.log(i + ":i, step:" + step + " get: " + this.get(i,step) + " n: " + n);
        n -= bits0;
        i += step;
        index = i - 1;
      }
      return index;
    }

    while (n > 0) {
      const d = this.get(i, step);
      const bits0 = step - countSetBits(d);
      //console.log(i + ":i, step:" + step + " get: " + this.get(i,step) + " n: " + n);

      if (n - bits0 < 0) {
        step = Math.max(n, step / 2 | 0);
        continue;
      }
      n -= bits0;
      i += step;
      const diff = (n === 0) ? bit0(d, 1, step) : 1;
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
function RankDirectory(
  directoryData,
  bitData,
  numBits,
  l1Size,
  l2Size,
) {
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
      const o = x;
      if (x >= this.l2Size) {
        sectionPos = (x / this.l2Size | 0) * this.l1Bits;
        rank = this.directory.get(sectionPos - this.l1Bits, this.l1Bits);
        x = x % this.l2Size;
      }
      const ans = (x > 0) ? this.data.pos0(rank + 1, x) : rank;
      if (config.debug) {
        console.log(
          "ans: " + ans + " " + rank + ":r, x: " + x + " " + sectionPos +
            ":s " + this.l1Bits + ": l1",
        );
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
      sectionPos = (o / this.l1Size | 0) * this.sectionBits;
      rank = this.directory.get(sectionPos - this.l1Bits, this.l1Bits);
      //console.log("o: " + rank + " sec: " + sectionPos)
      o = o % this.l1Size;
    }

    if (o >= this.l2Size) {
      sectionPos += (o / this.l2Size | 0) * this.l2Bits;
      rank += this.directory.get(sectionPos - this.l2Bits, this.l2Bits);
      //console.log("o2: " + rank + " sec: " + sectionPos)
    }

    rank += this.data.count(x - x % this.l2Size, x % this.l2Size + 1);

    //console.log("ans: " + rank + " x: " + o + " " + sectionPos + ":s, o: " + x);

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
    let iter = 0;

    // todo: assert y less than numBits
    if (config.selectsearch) {
      return this.rank(0, y);
    }

    while (high - low > 1) {
      const probe = (high + low) / 2 | 0;
      const r = this.rank(which, probe);
      iter += 1;

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
      if ((header << i) === 0) break;
      if ((header & mask) === mask) {
        tagIndices.push(i);
      }
      mask = mask >>> 1;
    }
    // flags.length must be equal to tagIndices.length
    if (tagIndices.length !== flags.length - 1) {
      console.log(
        tagIndices,
        flags,
        "flags and header mismatch (bug in upsert?)",
      );
      return values;
    }
    for (let i = 0; i < flags.length; i++) {
      const flag = flags[i + 1];
      const index = tagIndices[i];
      for (let j = 0, mask = 0x8000; j < 16; j++) {
        if ((flag << j) === 0) break;
        if ((flag & mask) === mask) {
          const pos = (index * 16) + j;
          if (config.debug) {
            console.log(
              "pos",
              pos,
              "index/tagIndices",
              index,
              tagIndices,
              "j/i",
              j,
              i,
            );
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
  this.trie = trie;
  this.index = index;

  // retrieve the 7-bit/6-bit letter.
  let finCached, whCached, comCached, fcCached, chCached, valCached, flagCached;
  this.final = () => {
    if (typeof (finCached) === "undefined") {
      finCached = this.trie.data.get(this.trie.letterStart + (index * this.trie.bitslen) + this.trie.extraBit, 1) === 1;
    }
    return finCached;
  };
  this.where = () => {
    if (typeof (whCached) === "undefined") {
      whCached = this.trie.data.get(this.trie.letterStart + (index * this.trie.bitslen) + 1 + this.trie.extraBit, this.trie.bitslen - 1 - this.trie.extraBit);
    }
    return whCached;
  };
  this.compressed = () => {
    if (typeof (comCached) === "undefined") {
      comCached = this.trie.data.get(this.trie.letterStart + (index * this.trie.bitslen), 1) === 1;
    }
    return comCached;
  };
  this.flag = () => {
    if (typeof (flagCached) === "undefined") {
      flagCached = this.compressed() && this.final();
    }
    return flagCached;
  };

  this.letter = () => this.where();

  this.firstChild = () => {
    if (!fcCached) fcCached = this.trie.directory.select(0, index + 1) - index;
    return fcCached;
  };

  if (config.debug) {
    console.log(
      index + " :i, fc: " + this.firstChild() + " tl: " + this.letter() +
        " c: " + this.compressed() + " f: " + this.final() + " wh: " +
        this.where() + " flag: " + this.flag(),
    );
  }

  this.childOfNextNode = () => {
    if (!chCached) {
      chCached = this.trie.directory.select(0, index + 2) - index - 1;
    }
    return chCached;
  };

  this.childCount = () => this.childOfNextNode() - this.firstChild();

  this.value = () => {
    if (typeof (valCached) === "undefined") {
      //let valueChain = this;
      const value = [];
      let i = 0;
      let j = 0;
      if (config.debug) {
        console.log(
          "thisnode: index/vc/ccount ",
          this.index,
          this.letter(),
          this.childCount(),
        );
      }
      while (i < this.childCount()) {
        const valueChain = this.getChild(i);
        if (config.debug) {
          console.log(
            "vc no-flag end vlet/vflag/vindex/val ",
            i,
            valueChain.letter(),
            valueChain.flag(),
            valueChain.index,
            value,
          );
        }
        if (!valueChain.flag()) {
          break;
        }
        if (i % 2 === 0) {
          value.push(valueChain.letter() << 8);
        } else {
          value[j] = (value[j] | valueChain.letter());
          j += 1;
        }
        i += 1;
      }
      valCached = value;
    }

    return valCached;
  };
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
  },

  /**
   * Retrieve the FrozenTrieNode of the trie, given its index in level-order.
   * This is a private function that you don't have to use.
   */
  getNodeByIndex: function (index) {
    // todo: index less than letterStart?
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
    const index = word.lastIndexOf(ENC_DELIM[0]);
    if (index > 0) word = word.slice(0, index); //: word.slice(index + 1)
    const debug = config.debug;
    let node = this.getRoot();
    let child;    
    let returnValue = false;
    for (let i = 0; i < word.length; i++) {
      let isFlag = -1;
      let that;
      if (periodEncVal[0] == word[i]) {
        if (node.final()) {
          if (returnValue == false) returnValue = new Map();
          returnValue.set(
            TxtDec.decode(word.slice(0, i).reverse()),
            node.value(),
          );
        }
      }
      do {
        that = node.getChild(isFlag + 1);
        if (!that.flag()) break;
        isFlag += 1;
      } while (isFlag + 1 < node.getChildCount());

      const minChild = isFlag;
      if (debug) {
        console.log(
          "            count: " + node.getChildCount() + " i: " + i + " w: " +
            word[i] + " nl: " + node.letter() + " flag: " + isFlag,
        );
      }

      if ((node.getChildCount() - 1) <= minChild) {
        if (debug) {
          console.log(
            "  no more children left, remaining word: " + word.slice(i),
          );
        }
        // fixme: fix these return false to match the actual return value?
        return returnValue;
      }
      if (config.useBinarySearch === false) {
        let j = isFlag;
        for (; j < node.getChildCount(); j++) {
          child = node.getChild(j);
          if (debug) {
            console.log(
              "it: " + j + " tl: " + child.letter() + " wl: " + word[i],
            );
          }
          if (child.letter() == word[i]) {
            if (debug) console.log("it: " + j + " break ");
            break;
          }
        }

        if (j === node.getChildCount()) {
          if (debug) console.log("j: " + j + " c: " + node.getChildCount());
          return returnValue;
        }
      } else {
        let high = node.getChildCount();
        let low = isFlag;

        while (high - low > 1) {
          const probe = (high + low) / 2 | 0;
          child = node.getChild(probe);
          const prevchild = (probe > isFlag) ? node.getChild(probe - 1) : undefined;
          if (debug) {
            console.log(
              "        current: " + child.letter() + " l: " + low + " h: " +
                high + " w: " + word[i],
            );
          }

          if (
            child.compressed() ||
            (prevchild && (prevchild.compressed() && !prevchild.flag()))
          ) {
            const startchild = [];
            const endchild = [];
            let start = 0;
            let end = 0;

            startchild.push(child);
            start += 1;

            // startchild len > word len terminate
            // fixme: startchild first letter != w first letter terminate
            do {
              const temp = node.getChild(probe - start);
              if (!temp.compressed()) break;
              if (temp.flag()) break;
              startchild.push(temp);
              start += 1;
            } while (true);

            //console.log("  check: letter : "+startchild[start - 1].letter()+" word : "+word[i]+" start: "+start)
            if (startchild[start - 1].letter() > word[i]) {
              if (debug) {
                console.log(
                  "        shrinkh start: " + startchild[start - 1].letter() +
                    " s: " + start + " w: " + word[i],
                );
              }

              high = probe - start + 1;
              if (high - low <= 1) {
                if (debug) {
                  console.log(
                    "...h-low: " + (high - low) + " c: " + node.getChildCount(),
                    high,
                    low,
                    child.letter(),
                    word[i],
                    probe,
                  );
                }
                return returnValue;
              }
              continue;
            }

            // if the child itself the last-node in the seq
            // nothing to do, there's no endchild to track
            if (child.compressed()) {
              do {
                end += 1;
                const temp = node.getChild(probe + end);
                endchild.push(temp);
                if (!temp.compressed()) break;
                // cannot encounter a flag whilst probing higher indices
                // since flag is always at index 0.
              } while (true);
            }

            if (startchild[start - 1].letter() < word[i]) {
              if (debug) {
                console.log(
                  "        shrinkl start: " + startchild[start - 1].letter() +
                    " s: " + start + " w: " + word[i],
                );
              }

              low = probe + end;

              if (high - low <= 1) {
                if (debug) {
                  console.log(
                    "...h-low: " + (high - low) + " c: " + node.getChildCount(),
                    high,
                    low,
                    child.letter(),
                    word[i],
                    probe,
                  );
                }
                return returnValue;
              }
              continue;
            }

            const nodes = startchild.reverse().concat(endchild);
            const comp = nodes.map((n) => n.letter());
            const w = word.slice(i, i + comp.length);

            if (debug) {
              console.log(
                "it: " + probe + " tl: " + comp + " wl: " + w + " c: " +
                  child.letter(),
              );
            }

            if (w.length < comp.length) return returnValue;
            for (let i = 0; i < comp.length; i++) {
              if (w[i] !== comp[i]) return returnValue;
            }

            if (debug) console.log("it: " + probe + " break ");

            // final letter in compressed node is representative of all letters
            child = nodes[nodes.length - 1];
            i += comp.length - 1; // ugly compensate i++ at the top
            break;
          } else {
            if (child.letter() === word[i]) {
              break;
            } else if (word[i] > child.letter()) {
              low = probe;
            } else {
              high = probe;
            }
          }

          if (high - low <= 1) {
            if (debug) {
              console.log(
                "h-low: " + (high - low) + " c: " + node.getChildCount(),
                high,
                low,
                child.letter(),
                word[i],
                probe,
              );
            }
            return returnValue;
          }
        }
      }

      if (debug) console.log("        next: " + child.letter());

      node = child;
    }

    // using node.index, find value in rd.data after letterStart + (bitslen * nodeCount) + 1
    // level order indexing, fixme: see above re returning "false" vs [false] vs [[0], false]
    if (node.final()) {
      if (returnValue == false) returnValue = new Map();
      returnValue.set(TxtDec.decode(word.reverse()), node.value());
    }
    return returnValue;
  },
};

function customTagToFlag(fl, blocklistFileTag) {
  let res = CHR16(0);
  for (const flag of fl) {
    const val = blocklistFileTag[flag].value;
    const header = 0;
    const index = ((val / 16) | 0); // + 1;
    const pos = val % 16;
    let h = 0;
    h = DEC16(res[header]);

    const dataIndex = countSetBits(h & BitString.MaskBottom[16][16 - index]) +
      1;
    let n = (((h >>> (15 - (index))) & 0x1) !== 1) ? 0 : DEC16(res[dataIndex]);
    const upsertData = (n !== 0);
    h |= 1 << (15 - index);
    n |= 1 << (15 - pos);
    res = CHR16(h) + res.slice(1, dataIndex) + CHR16(n) +
      res.slice(upsertData ? (dataIndex + 1) : dataIndex);
  }
  return res;
}

function createBlocklistFilter(
  tdbuf,
  rdbuf,
  blocklistFileTag,
  blocklistBasicConfig,
) {
  initialize();
  try {
    let tag = {};
    let fl = [];
    for (const fileuname in blocklistFileTag) {
      if (!blocklistFileTag.hasOwnProperty(fileuname)) continue;
      fl[blocklistFileTag[fileuname].value] = fileuname;
      // reverse the value since it is prepended to
      // the front of key when not encoded with base32
      const v = DELIM + blocklistFileTag[fileuname].uname;
      tag[fileuname] = v.split("").reverse().join("");
    }

    const tags = new Tags(fl);
    const tdv = new bufferView[W](tdbuf);
    const rdv = new bufferView[W](rdbuf);
    const nc = blocklistBasicConfig.nodecount;
    const numbits = (blocklistBasicConfig.nodecount * 2) + 1;
    const rd = new RankDirectory(rdv, tdv, numbits, L1, L2);
    const frozentrie = new FrozenTrie(tdv, rd, nc);

    return { t: tags, ft: frozentrie };
  } catch (e) {
    throw e;
  }
}

export { createBlocklistFilter, customTagToFlag };
