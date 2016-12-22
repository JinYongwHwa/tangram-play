/* eslint-disable no-console */
import YAMLParser from 'yaml-ast-parser';
import { addressFromKeyStack, keyStackFromAddress } from './codemirror/yaml-tangram';

// YAML node kinds are assigned a number by YAMLParser.
// A node of type SCALAR is a simple key-value pair with a string `value`.
const YAML_SCALAR = 0;

// A node of type MAPPING is a key-value pair whose `value` is another YAML node.
// Values can be another MAPPING, a MAP, or SEQUENCE.
const YAML_MAPPING = 1;

// A node of type MAP is a value of the MAPPING node. It does not have a `value`
// but rather a `mappings` array of one or more YAML nodes.
const YAML_MAP = 2;

// A node of type SEQUENCE is a value of a YAML node. It does not have a `value`
// but rather a `items` array of one or more YAML nodes.
const YAML_SEQUENCE = 3;

// Other node kinds exist, we currently don't handle this.
// const YAML_ANCHOR_REF = 4; //?
// const YAML_INCLUDE_REF = 5; //? only RAML?

function parseYAML(content) {
  // Run all the content through the AST parser and store it here.
  // Timing of safeLoad: about 0.5-1.5ms for a small file, could be 20ms+ for a 6000 line Cinnabar.
  // `parsedYAML` will be undefined if content is blank (e.g. empty string)
  const parsedYAML = YAMLParser.safeLoad(content);

  if (parsedYAML && parsedYAML.errors.length > 0) {
    // TODO: Handle errors?
  }

  return parsedYAML;
}

/**
 * Given a parsed syntax tree of YAML, and a position index, return
 * the deepest node that contains that position. Returns nothing if not found.
 *
 * @param {Object} ast - a parsed syntax tree object, should be root of the tree
 * @param {Number} index - a position index
 * @returns {Object} a node
 */
function getNodeAtIndex(ast, index) {
  function searchNodes(node, idx) {
    // Nodes can be `null` if current document is blank or has errors
    if (!node) return null;

    if (idx < node.startPosition || idx > node.endPosition) {
      if (node.parent) return node.parent;
    }

    switch (node.kind) {
      // A scalar node has no further depth; return as is.
      case YAML_SCALAR:
        return node;
      case YAML_MAPPING:
        return searchNodes(node.value, idx);
      case YAML_MAP:
        // Find the first node in node.mappings that contains idx and
        // continue searching
        for (let i = 0, j = node.mappings.length; i < j; i++) {
          const mapping = node.mappings[i];
          // Can be null if document has errors
          if (!mapping) return null;
          if (idx >= mapping.startPosition && idx <= mapping.endPosition) {
            return searchNodes(mapping.value, idx);
          }
        }
        return null;
      case YAML_SEQUENCE:
        // See if index falls in any of the sequence items
        for (let i = 0, j = node.items.length; i < j; i++) {
          const item = node.items[i];
          // Can be null if document has errors
          if (!item) return null;
          if (idx >= item.startPosition && idx <= item.endPosition) {
            return searchNodes(item, idx);
          }
        }
        // If not, return the sequence node itself
        return node;
      default:
        if (idx >= node.startPosition && idx <= node.startPosition) {
          return node;
        } else if (node.parent) {
          return node.parent;
        }
        return null;
    }
  }

  const node = searchNodes(ast, index);
  return node;
}

/**
 * Given an address, return a node representing its value(s). This is used when
 * Tangram refers to a scene file only with address, rather than a position value
 * in a scene file.
 *
 * @param {Object} ast - a parsed syntax tree object, should be root of the tree
 * @param {string} address - an address that looks like "this:string:example"
 * @returns {Object} a node
 */
function getNodeAtKeyAddress(ast, address) {
  function searchNodes(node, stack) {
    // Nodes can be `null` if current document is blank or has errors
    if (!node) return null;

    switch (node.kind) {
      // A scalar node has no further depth; return its parent node, which
      // includes its key.
      case YAML_SCALAR:
        return node.parent;
      case YAML_MAPPING:
        return searchNodes(node.value, stack);
      case YAML_MAP:
        // Find the first node in node.mappings that contains stack[0].
        // If found, remove from stack and continue searching with remainder
        // of the stack.
        for (let i = 0, j = node.mappings.length; i < j; i++) {
          const mapping = node.mappings[i];
          // Can be null if document has errors
          if (!mapping) return null;
          if (mapping.key.value === stack[0]) {
            stack.shift();

            // If keys remain in stack, keep searching
            if (stack.length > 0) {
              return searchNodes(mapping.value, stack);
            }

            // Otherwise, return the found mapping
            return mapping;
          }
        }

        // If not found, return null.
        return null;
      // A sequence node has no further depth (in Tangram YAML anyway);
      // return its parent node, which includes its key.
      case YAML_SEQUENCE:
        return node.parent;
      default:
        return null;
    }
  }

  const stack = keyStackFromAddress(address);
  const node = searchNodes(ast, stack);
  return node;
}

/**
 * Given an AST node, construct a key address for it by traversing its parent nodes.
 *
 * @param {Object} node - a node from YAML-AST-parser
 * @returns {string} address - an address that looks like "this:string:example"
 */
export function getKeyAddressForNode(node) {
  function builder(currentNode, stack = []) {
    // Nodes can be `null` if current document state has errors
    if (!currentNode) return null;

    // Add key's value to the current key stack.
    // Only accept scalar values for keys
    if (currentNode.key && currentNode.key.kind === YAML_SCALAR) {
      stack.push(currentNode.key.value);
    }

    // Traverse parents until we hit no more parents
    if (currentNode.parent) {
      stack.concat(builder(currentNode.parent, stack));
    }

    return stack;
  }

  const stack = builder(node, []);
  stack.reverse();
  return addressFromKeyStack(stack);
}

/**
 * Given an AST node, convert its `startPosition` and `endPosition` values to
 * CodeMirror editor positions.
 *
 * @param {Object} node - a node from YAML-AST-parser
 * @param {CodeMirror.doc} doc - the CodeMirror document
 * @returns {Object} range - an object of this shape:
 *        range = {
 *          from: { line, ch },
 *          to: { line, ch }
 *        }
 * @todo Does this function belong here?
 */
export function getPositionsForNode(node, doc) {
  // Returns a null object of similar shape if a node is undefined
  if (!node) {
    const nullPos = { line: null, ch: null };
    return { from: nullPos, to: nullPos };
  }

  const startPosition = doc.posFromIndex(node.startPosition);
  const endPosition = doc.posFromIndex(node.endPosition);
  return {
    from: startPosition,
    to: endPosition,
  };
}

export class ParsedYAMLDocument {
  constructor(content) {
    this.nodes = {};
    this.regenerate(content);
  }

  regenerate(content) {
    this.nodes = parseYAML(content) || {};
  }

  getNodeAtIndex(index) {
    return getNodeAtIndex(this.nodes, index);
  }

  getNodeAtKeyAddress(address) {
    return getNodeAtKeyAddress(this.nodes, address);
  }
}