import {
  List,
  parse,
  lexer,
  generate,
  type CssNode,
  type Value,
} from "css-tree";

const createValueNode = (data?: CssNode[]): Value => ({
  type: "Value",
  children: new List<CssNode>().fromArray(data ?? []),
});

const createInitialNode = (): Value => ({
  type: "Value",
  children: new List<CssNode>().appendData({
    type: "Identifier",
    name: "initial",
  }),
});

const getValueList = (value: CssNode): CssNode[] => {
  const children = "children" in value ? value.children?.toArray() : undefined;
  return children ?? [value];
};

const splitBySlash = (list: List<CssNode> | CssNode[]) => {
  const lists: Array<undefined | CssNode[]> = [[]];
  for (const node of list) {
    if (node.type === "Operator" && node.value === "/") {
      lists.push([]);
    } else {
      lists.at(-1)?.push(node);
    }
  }
  return lists;
};

/**
 * Match the list of specified syntaxes with nodes
 * Matches can be placed in different order than the list
 * All specified matches are optional
 * Value Definition Syntax use <Type> || <Type> operator for describe this
 */
const parseUnordered = (syntaxes: string[], value: CssNode) => {
  const matched = new Map<string, Value>();
  const unprocessedSyntaxes = new Set(syntaxes);
  let unprocessedNodes = getValueList(value);
  let lastCursor = 0;
  while (unprocessedSyntaxes.size > 0 && unprocessedNodes.length > 0) {
    let nextCursor = lastCursor;
    for (const syntax of unprocessedSyntaxes) {
      const buffer = [];
      let value: undefined | Value;
      let cursor = 0;
      for (const node of unprocessedNodes) {
        buffer.push(node);
        const newValue = createValueNode(buffer);
        if (lexer.match(syntax, newValue).matched) {
          value = newValue;
          cursor = buffer.length;
        }
      }
      if (value) {
        matched.set(syntax, value);
        unprocessedNodes = unprocessedNodes.slice(cursor);
        unprocessedSyntaxes.delete(syntax);
        nextCursor += cursor;
      }
    }
    // last pass is the same as previous one
    // which means infinite loop detected
    if (lastCursor === nextCursor) {
      break;
    }
    lastCursor = nextCursor;
  }
  return [
    ...syntaxes.map((syntax) => matched.get(syntax)),
    createValueNode(unprocessedNodes),
  ];
};

/**
 *
 * border = <line-width> || <line-style> || <color>
 *
 */
const expandBorder = function* (property: string, value: CssNode) {
  switch (property) {
    case "border":
    case "border-inline":
    case "border-inline-start":
    case "border-inline-end":
    case "border-block":
    case "border-block-start":
    case "border-block-end":
    case "border-top":
    case "border-right":
    case "border-bottom":
    case "border-left":
    case "outline": {
      const [width, style, color] = parseUnordered(
        ["<line-width>", "<line-style>", "<color>"],
        value
      );
      yield [`${property}-width`, width ?? createInitialNode()] as const;
      yield [`${property}-style`, style ?? createInitialNode()] as const;
      yield [`${property}-color`, color ?? createInitialNode()] as const;
      break;
    }
    default:
      yield [property, value] as const;
  }
};

type GetProperty = (edge: string) => string;

const expandBox = function* (getProperty: GetProperty, value: CssNode) {
  const [top, right, bottom, left] = getValueList(value);
  yield [getProperty("top"), top] as const;
  yield [getProperty("right"), right ?? top] as const;
  yield [getProperty("bottom"), bottom ?? top] as const;
  yield [getProperty("left"), left ?? right ?? top] as const;
};

const expandLogical = function* (getProperty: GetProperty, value: CssNode) {
  const [start, end] = getValueList(value);
  yield [getProperty("start"), start] as const;
  yield [getProperty("end"), end ?? start] as const;
};

const expandEdges = function* (property: string, value: CssNode) {
  switch (property) {
    case "margin":
    case "padding":
      yield* expandBox((edge) => `${property}-${edge}`, value);
      break;
    case "margin-inline":
    case "padding-inline":
    case "margin-block":
    case "padding-block":
      yield* expandLogical((edge) => `${property}-${edge}`, value);
      break;
    case "inset":
      yield* expandBox((edge) => edge, value);
      break;
    case "inset-inline":
    case "inset-block":
      yield* expandLogical((edge) => `${property}-${edge}`, value);
      break;
    case "border-width":
    case "border-style":
    case "border-color": {
      const type = property.split("-").pop() ?? ""; // width, style or color
      yield* expandBox((edge) => `border-${edge}-${type}`, value);
      break;
    }
    case "border-inline-width":
    case "border-inline-style":
    case "border-inline-color": {
      const type = property.split("-").pop() ?? ""; // width, style or color
      yield* expandLogical((edge) => `border-inline-${edge}-${type}`, value);
      break;
    }
    case "border-block-width":
    case "border-block-style":
    case "border-block-color": {
      const type = property.split("-").pop() ?? ""; // width, style or color
      yield* expandLogical((edge) => `border-block-${edge}-${type}`, value);
      break;
    }
    default:
      yield [property, value] as const;
  }
};

/**
 *
 * border-radius = <length-percentage [0,∞]>{1,4} [ / <length-percentage [0,∞]>{1,4} ]?
 *
 */
const expandBorderRadius = function* (property: string, value: CssNode) {
  if (property !== "border-radius") {
    yield [property, value] as const;
    return;
  }
  const firstRadius = [];
  const secondRadius = [];
  let hasSecondRadius = false;
  for (const node of getValueList(value)) {
    if (node.type === "Operator" && node.value === "/") {
      hasSecondRadius = true;
    } else if (hasSecondRadius) {
      secondRadius.push(node);
    } else {
      firstRadius.push(node);
    }
  }
  const topLeft = createValueNode();
  const topRight = createValueNode();
  const bottomRight = createValueNode();
  const bottomLeft = createValueNode();
  // add first radius
  const [firstTopLeft, firstTopRight, firstBottomRight, firstBottomLeft] =
    firstRadius;
  topLeft.children.appendData(firstTopLeft);
  topRight.children.appendData(firstTopRight ?? firstTopLeft);
  bottomRight.children.appendData(firstBottomRight ?? firstTopLeft);
  bottomLeft.children.appendData(
    firstBottomLeft ?? firstTopRight ?? firstTopLeft
  );
  // add second radius if specified
  const [secondTopLeft, secondTopRight, secondBottomRight, secondBottomLeft] =
    secondRadius;
  if (hasSecondRadius) {
    topLeft.children.appendData(secondTopLeft);
    topRight.children.appendData(secondTopRight ?? secondTopLeft);
    bottomRight.children.appendData(secondBottomRight ?? secondTopLeft);
    bottomLeft.children.appendData(
      secondBottomLeft ?? secondTopRight ?? secondTopLeft
    );
  }
  yield ["border-top-left-radius", topLeft] as const;
  yield ["border-top-right-radius", topRight] as const;
  yield ["border-bottom-right-radius", bottomRight] as const;
  yield ["border-top-left-radius", bottomLeft] as const;
};

/**
 *
 * border-image =
 *   <'border-image-source'>
 *   || <'border-image-slice'> [ / <'border-image-width'> | / <'border-image-width'>? / <'border-image-outset'> ]?
 *   || <'border-image-repeat'>
 * <border-image-source> = none | <image>
 * <border-image-slice> = [ <number [0,∞]> | <percentage [0,∞]> ]{1,4} && fill?
 * <border-image-width> = [ <length-percentage [0,∞]> | <number [0,∞]> | auto ]{1,4}
 * <border-image-outset> = [ <length [0,∞]> | <number [0,∞]> ]{1,4}
 * <border-image-repeat> = [ stretch | repeat | round | space ]{1,2}
 *
 */
const expandBorderImage = function* (property: string, value: CssNode) {
  if (property !== "border-image") {
    yield [property, value] as const;
    return;
  }
  const [source, config, repeat] = parseUnordered(
    [
      "<'border-image-source'>",
      "<'border-image-slice'> [ / <'border-image-width'> | / <'border-image-width'>? / <'border-image-outset'> ]?",
      "<'border-image-repeat'>",
    ],
    value
  );
  let slice = createInitialNode();
  let width = createInitialNode();
  let outset = createInitialNode();
  if (config) {
    const [sliceNodes, widthNodes, outsetNodes] = splitBySlash(config.children);
    if (sliceNodes && sliceNodes.length > 0) {
      slice = createValueNode(sliceNodes);
    }
    if (widthNodes && widthNodes.length > 0) {
      width = createValueNode(widthNodes);
    }
    if (outsetNodes && outsetNodes.length > 0) {
      outset = createValueNode(outsetNodes);
    }
  }
  yield ["border-image-source", source ?? createInitialNode()] as const;
  yield ["border-image-slice", slice] as const;
  yield ["border-image-width", width] as const;
  yield ["border-image-outset", outset] as const;
  yield ["border-image-repeat", repeat ?? createInitialNode()] as const;
};

const expandGap = function* (property: string, value: CssNode) {
  switch (property) {
    case "gap":
    case "grid-gap": {
      const [rowGap, columnGap] = getValueList(value);
      yield ["row-gap", rowGap] as const;
      yield ["column-gap", columnGap ?? rowGap] as const;
      break;
    }
    case "grid-row-gap":
      yield ["row-gap", value] as const;
      break;
    case "grid-column-gap":
      yield ["column-gap", value] as const;
      break;
    default:
      yield [property, value] as const;
  }
};

const expandPlace = function* (property: string, value: CssNode) {
  switch (property) {
    case "place-content": {
      const [align, justify] = getValueList(value);
      yield ["align-content", align] as const;
      yield ["justify-content", justify ?? align] as const;
      break;
    }
    case "place-items": {
      const [align, justify] = getValueList(value);
      yield ["align-items", align] as const;
      yield ["justify-items", justify ?? align] as const;
      break;
    }
    case "place-self": {
      const [align, justify] = getValueList(value);
      yield ["align-self", align] as const;
      yield ["justify-self", justify ?? align] as const;
      break;
    }
    default:
      yield [property, value] as const;
  }
};
/**
 *
 * font =
 *   [ <'font-style'> || <font-variant-css2> || <'font-weight'> || <font-width-css3> ]?
 *   <'font-size'> [ / <'line-height'> ]? <'font-family'>
 *
 * text-decoration =
 *   <'text-decoration-line'> ||
 *   <'text-decoration-style'> ||
 *   <'text-decoration-color'>
 *
 * text-emphasis =
 *   <'text-emphasis-style'> ||
 *   <'text-emphasis-color'>
 */
const expandText = function* (property: string, value: CssNode) {
  switch (property) {
    case "font": {
      // const [before, after] = splitBySlash(getValueList(value));
      const [fontStyle, fontVariant, fontWeight, fontWidth, config] =
        parseUnordered(
          [
            "<'font-style'>",
            // <font-variant-css2> is unsupported by csstree
            "[ normal | small-caps ]",
            "<'font-weight'>",
            // <font-width-css3> is unsupported by csstree
            "[ normal | ultra-condensed | extra-condensed | condensed | semi-condensed | semi-expanded | expanded | extra-expanded | ultra-expanded ]",
          ],
          value
        );
      let fontSize: CssNode = createInitialNode();
      let lineHeight: CssNode = createInitialNode();
      let fontFamily: CssNode = createInitialNode();
      if (config) {
        if (
          lexer.match("<'font-size'> / <'line-height'> <'font-family'>", config)
            .matched
        ) {
          const [fontSizeNode, _slashNode, lineHeightNode, ...fontFamilyNodes] =
            getValueList(config);
          fontSize = fontSizeNode;
          lineHeight = lineHeightNode;
          fontFamily = createValueNode(fontFamilyNodes);
        } else {
          const [fontSizeNode, ...fontFamilyNodes] = getValueList(config);
          fontSize = fontSizeNode;
          fontFamily = createValueNode(fontFamilyNodes);
        }
      }
      yield ["font-style", fontStyle ?? createInitialNode()] as const;
      yield ["font-variant", fontVariant ?? createInitialNode()] as const;
      yield ["font-weight", fontWeight ?? createInitialNode()] as const;
      yield ["font-width", fontWidth ?? createInitialNode()] as const;
      yield ["font-size", fontSize] as const;
      yield ["line-height", lineHeight] as const;
      yield ["font-family", fontFamily] as const;
      break;
    }

    case "text-decoration": {
      const [line, style, color] = parseUnordered(
        [
          "<'text-decoration-line'>",
          "<'text-decoration-style'>",
          "<'text-decoration-color'>",
        ],
        value
      );
      yield ["text-decoration-line", line ?? createInitialNode()] as const;
      yield ["text-decoration-style", style ?? createInitialNode()] as const;
      yield ["text-decoration-color", color ?? createInitialNode()] as const;
      break;
    }

    case "text-emphasis": {
      const [style, color] = parseUnordered(
        ["<'text-emphasis-style'>", "<'text-emphasis-color'>"],
        value
      );
      yield ["text-emphasis-style", style ?? createInitialNode()] as const;
      yield ["text-emphasis-color", color ?? createInitialNode()] as const;
      break;
    }

    default:
      yield [property, value] as const;
  }
};

const parseValue = function* (property: string, value: string) {
  try {
    const ast = parse(value, { context: "value" });
    yield [property, ast] as const;
  } catch {
    // empty block
  }
};

export const expandShorthands = (
  shorthands: [property: string, value: string][]
) => {
  const longhands: [property: string, value: string][] = [];
  for (const [property, value] of shorthands) {
    const generator = parseValue(property, value);

    for (const [property, value] of generator) {
      const generator = expandBorder(property, value);

      for (const [property, value] of generator) {
        const generator = expandEdges(property, value);

        for (const [property, value] of generator) {
          const generator = expandBorderRadius(property, value);

          for (const [property, value] of generator) {
            const generator = expandBorderImage(property, value);

            for (const [property, value] of generator) {
              const generator = expandGap(property, value);

              for (const [property, value] of generator) {
                const generator = expandPlace(property, value);

                for (const [property, value] of generator) {
                  const generator = expandText(property, value);

                  for (const [property, value] of generator) {
                    longhands.push([property, generate(value)]);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return longhands;
};
