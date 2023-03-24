import { memoPromise, range, sleep } from "./lib/lang.js"
import { grind, over, view } from "./lib/lenses.js"

/*

TODOs

define serializable lenses?
clean up metalui, dejavue etc.
DOM-diff performance
use webworker to make sync
svg2canvas
eqal to include ref type, for memoizing components
sub-abstractui implementation on canvas?

How to use in WS
  hierarchy view?
  pie chart

*/

// Set node values, attribute and event handlers.
const attributesǃ = (node, props, onEventǃ) => {
  for (const [key, val] of Object.entries(props)) {
    switch (key) {
      case "canvas-draw":
        const g = node.getContext("2d")
        g.fillStyle = "red"
        g.fillRect(10, 10, 80, 80)
        break

      case "scrollTop":
        requestAnimationFrame(() => {
          node.scrollTop = val
        })
        break

      case "style":
        node.setAttribute(
          key,
          Object.entries(val)
            .map(([k, v]) => `${k}: ${v};`)
            .join(" ")
        )
        break

      case "value":
        node.value = val
        break

      case "window-handle":
        node.onmousedown = (rawEvent) =>
          onEventǃ({ ...val, reason: "kernel/window-handle" }, rawEvent)
        requestAnimationFrame(() => {
          const ancestor = document.getElementById(val.windowId)
          const bounds = ancestor.getBoundingClientRect()
          ancestor.style.left = (document.body.offsetWidth - bounds.width) / 2
          ancestor.style.top = (document.body.offsetHeight - bounds.height) / 2
        })
        break

      case "with-scroll":
        node.onscroll = (rawEvent) =>
          onEventǃ({ ...val, reason: "kernel/with-scroll" }, rawEvent)
        break

      case "with-drag":
        node.onmousedown = (rawEvent) => {
          onEventǃ({ ...val, reason: "kernel/drag-start" }, rawEvent)
        }
        break

      case "with-drop":
        node.onmouseup = (rawEvent) => {
          onEventǃ({ ...val, reason: "kernel/drop" }, rawEvent)
        }
        break

      default:
        if (!key.startsWith("on")) {
          node.setAttribute(key, val)
        } else {
          node[key.toLowerCase()] = (rawEvent) => onEventǃ(val, rawEvent)
        }
        break
    }
  }
}

const withProgress =
  (f) =>
  async (...args) => {
    document.getElementById("app").style.opacity = 0.5

    return f(...args).then((r) => {
      document.getElementById("app").style.opacity = 1

      return r
    })
  }

// Create a new app
const createApp = (initialState) => {
  let state
  let prev = []

  const eventHandlers = {}
  let withDrag
  let withPosition
  const withMeasures = {}

  const onEventǃ = async (event, rawEvent) => {
    switch (event.reason) {
      case "kernel/drag-start":
        withDrag = {
          event,
          dragElement: null,
        }
        break

      case "kernel/drop":
        if (withDrag && withDrag.dragElement) {
          onEventǃ({ reason: "drop", source: withDrag.event, target: event })
        }
        return

      case "kernel/init":
        state = initialState
        break

      case "kernel/with-measures":
        {
          let rerender = false
          for (const { id, node, properties } of event.measures) {
            const values = properties.map((p) => node[p])
            if (!eqal(withMeasures[id], values)) {
              withMeasures[id] = values
              rerender = true
            }
          }

          if (!rerender) {
            return
          }
        }
        break

      case "kernel/window-handle":
        {
          const ancestor = document.getElementById(event.windowId)
          const bounds = ancestor.getBoundingClientRect()
          withPosition = (clientX, clientY) => {
            ancestor.style.left = bounds.x + clientX - rawEvent.clientX
            ancestor.style.top = bounds.y + clientY - rawEvent.clientY
          }
        }
        return

      case "kernel/with-scroll":
        state = over(
          state,
          grind(...event.lens),
          () => rawEvent.target.scrollTop
        )
        break

      default:
        if (eventHandlers[event.reason]) {
          const newState = eventHandlers[event.reason](state, event, rawEvent)
          if (newState === state) {
            return
          }

          state = newState
          break
        } else {
          console.warn(`Unknown event ${event.reason}`)
          return
        }
    }

    const tmp = await withProgress(render)(
      eventHandlers,
      [App, { state }],
      withMeasures
    )
    const measures = domǃ(document.getElementById("app"), tmp, prev, {
      onEventǃ,
    })
    prev = tmp
    if (measures.length) {
      await onEventǃ({ reason: "kernel/with-measures", measures })
    }
  }

  window.addEventListener("mousemove", (rawEvent) => {
    if (withDrag) {
      if (!withDrag.dragElement) {
        withDrag.dragElement = document.getElementById("with-drag")
        render({}, withDrag.event.dragImage, {}).then((r) => {
          domǃ(withDrag.dragElement, r, [], { onEventǃ })
        })
      }

      // make sure the drag image is not underneath the pointer, otherwise the mouseup won't
      // fire on the drop target
      withDrag.dragElement.style.left = rawEvent.clientX + 8
      withDrag.dragElement.style.top = rawEvent.clientY - 8
    } else if (withPosition) {
      withPosition(rawEvent.clientX, rawEvent.clientY)
    }
  })

  window.addEventListener("mouseup", (rawEvent) => {
    if (withDrag) {
      if (withDrag.dragElement) {
        withDrag.dragElement.replaceChildren()
      }

      withDrag = undefined
    }

    withPosition = undefined
  })

  window.addEventListener("resize", () => {
    onEventǃ({
      reason: "kernel/with-measures",
      measures: [
        {
          id: "WINDOW",
          node: document.body,
          properties: ["offsetWidth", "offsetHeight"],
        },
      ],
    })
  })

  onEventǃ({ reason: "kernel/init" })
}

// Update DOM with differences from prev to els.
const domǃ = (target, els, prev, { ns, onEventǃ }) => {
  const measures = []
  for (let i = 0; i < els.length; i += 1) {
    const el = els[i]
    if (Array.isArray(el)) {
      // element node
      const [tag, { _measure, ...props }, ...children] = el
      if (!Array.isArray(prev[i]) || prev[i][0] !== tag) {
        // new
        if (tag === "svg") {
          ns = "http://www.w3.org/2000/svg"
        }
        const node = !ns
          ? document.createElement(tag)
          : document.createElementNS(ns, tag)

        if (_measure) {
          measures.push({
            node,
            ..._measure,
          })
        }

        attributesǃ(node, props, onEventǃ)

        if (i >= target.childNodes.length) {
          target.appendChild(node)
        } else {
          target.replaceChild(node, target.childNodes[i])
        }

        measures.push(...domǃ(node, children, [], { ns, onEventǃ }))
      } else {
        // update
        const node = target.childNodes[i]

        if (_measure) {
          measures.push({
            node,
            ..._measure,
          })
        }

        // removed attributes
        for (const key of Object.keys(prev[i][1])) {
          if (props[key] === undefined) {
            node.removeAttribute(key)
          }
        }

        // update attributes
        attributesǃ(
          node,
          Object.fromEntries(
            Object.entries(props).filter(
              ([key, val]) => !eqal(val, prev[i][1][key])
            )
          ),
          onEventǃ
        )

        measures.push(
          ...domǃ(node, children, prev[i].slice(2), { ns, onEventǃ })
        )
      }
    } else {
      // text node
      if (el !== prev[i]) {
        // new
        const node = document.createTextNode(el)

        if (i >= target.childNodes.length) {
          target.appendChild(node)
        } else {
          target.replaceChild(node, target.childNodes[i])
        }
      } else {
        // update
        if (el !== prev[i]) {
          target.childNodes[i].nodeValue = el
        }
      }
    }
  }

  while (target.childNodes.length > els.length) {
    target.removeChild(target.lastChild)
  }

  return measures
}

const eqal = (a, b) => {
  if (a === b) {
    return true
  }

  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime()
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => eqal(x, b[i]))
  }

  if (typeof a === "object" && typeof b === "object") {
    const keys = Object.keys(a)
    if (Object.keys(b).length !== keys.length) {
      // assumes no values of undefined
      return false
    }

    return keys.every((key) => eqal(a[key], b[key]))
  }

  return false
}

// Render dsl to markup
const render = async (handlers, el, withMeasures) => {
  if (Array.isArray(el)) {
    const [tag, props, ...children] = el

    if (typeof tag === "function") {
      return render(handlers, await tag({ ...props, children }), withMeasures)
    } else if (tag && tag.type) {
      switch (tag.type) {
        case "event-handlers":
          Object.assign(handlers, tag.handlers)
          return render(
            handlers,
            await tag.component({ ...props, children }),
            withMeasures
          )

        case "with-measures": {
          {
            const { component, measure, property } = tag
            const r = await component({
              [property]: withMeasures[measure.id],
              ...props,
              children,
            })

            return render(
              handlers,
              [r[0], { _measure: measure, ...r[1] }, ...r.slice(2)],
              withMeasures
            )
          }
        }
      }
    }

    let mapped = []
    for (const child of children) {
      const tmp = await render(handlers, child, withMeasures)
      mapped = [...mapped, ...tmp]
    }

    return tag !== "fragment" ? [[tag, props, ...mapped]] : mapped
  }

  return el !== null ? [String(el)] : []
}

// Primitives
const Button = ({ label, onClick }) => ["button", { onClick }, label]

const Canvas = ({ width, height, children, ...rest }) => [
  "canvas",
  { width, height, "canvas-draw": children },
]

const eventHandlers = (component, handlers) => ({
  type: "event-handlers",
  component,
  handlers,
})

const Fragment = ({ children }) => ["fragment", {}, ...children]

const HGroup = ({ children, style }) => [
  "div",
  {
    style: { display: "flex", ...style },
  },
  ...children,
]

const VGroup = ({ children }) => [
  "div",
  {
    style: {
      "align-items": "start",
      display: "flex",
      "flex-direction": "column",
      height: "100%",
    },
  },
  ...children,
]

const Window = ({ children, id, onClose, title }) => [
  "div",
  {
    id,
    class: "window",
  },
  [
    "div",
    { class: "window__div" },
    [
      "div",
      {
        class: "window-title",
        "window-handle": { windowId: id },
      },
      ["div", {}, title],
      [
        "div",
        {
          onClick: onClose,
          style: { cursor: "pointer", position: "relative", top: "-3px" },
          title: "Close window",
        },
        "🗙",
      ],
    ],
  ],
  ["div", { class: "window-body" }, ...children],
]

const withSize = (component) => {
  const id = Math.random().toString(16).substring(2)

  return {
    type: "with-measures",
    component,
    measure: {
      id,
      properties: ["offsetWidth", "offsetHeight"],
    },
    property: "size",
  }
}

// Components
const Blob = ({ color, drd }) => [
  "div",
  {
    style: { height: "100px", width: "100px" },
    [drd]: { color },
  },
  [
    "svg",
    { width: 100, height: 100 },
    [
      "rect",
      {
        x: 10,
        y: 10,
        width: 80,
        height: 80,
        stroke: "black",
        fill: color,
      },
    ],
  ],
]

const Editable = eventHandlers(
  ({ state, lens }) => {
    const value = view(state, grind(...lens))

    return !value._edit
      ? [
          "span",
          {
            onClick: { reason: "Editable/edit-user", lens },
            style: "cursor: pointer;",
          },
          value,
        ]
      : [
          "input",
          {
            autofocus: true,
            "data-lpignore": true,
            onChange: { reason: "Editable/update-user", lens },
            onInput: { reason: "Editable/user-input", lens },
            type: "text",
            value: value.tmp,
          },
        ]
  },
  {
    "Editable/edit-user": (state, event) =>
      over(state, grind(...event.lens), (value) => ({
        _edit: true,
        tmp: value,
      })),

    "Editable/update-user": (state, event) =>
      over(state, grind(...event.lens), (value) => value.tmp),

    "Editable/user-input": (state, event, rawEvent) =>
      over(state, grind(...event.lens), (value) => ({
        ...value,
        tmp: rawEvent.target.value
          .split(/\s+/)
          .filter((w) => w)
          .map((w) => `${w[0].toUpperCase()}${w.substring(1)}`)
          .join(" "),
      })),
  }
)

const List = async ({ lazyItems, state }) => {
  const items = await lazyItems()

  return [
    Scroller,
    {
      itemHeight: 15,
      items,
      scrollLens: ["scrollTop"],
      state,
    },
    ({ index, item }) => [
      HGroup,
      {},
      ["div", { style: { width: "200px" } }, `${index + 1}. `, item],
      ...[...range(0, 14)].map((c) => [
        "div",
        { style: { width: "150px" } },
        item.substring(0, c) + item.substring(c + 1),
      ]),
    ],
  ]
}

const PALETTE = [
  "#8dd3c7",
  "#ffffb3",
  "#bebada",
  "#fb8072",
  "#80b1d3",
  "#fdb462",
  "#b3de69",
  "#fccde5",
  "#d9d9d9",
  "#bc80bd",
  "#ccebc5",
  "#ffed6f",
]

const rad = (d) => (Math.PI * d) / 180
const sum = (xs, f) => xs.reduce((r, x) => r + (f ? f(x) : x), 0)

const measureText = (s) => {
  const canvas = document.createElement("canvas")
  const g = canvas.getContext("2d")
  g.font = "11px Arial"

  return g.measureText(s).width
}

const truncateText = (s, w) => {
  if (s.length < 2 || measureText(s) <= w) {
    return null
  }

  const bounds = [0, s.length]
  while (bounds[1] - bounds[0] >= 2) {
    const m = Math.ceil((bounds[0] + bounds[1]) / 2)
    const t = s.substring(0, m) + "..."
    if (measureText(t) <= w) {
      bounds[0] = m
    } else {
      bounds[1] = m
    }
  }

  return s.substring(0, bounds[0]) + "..."
}

const findNiceIntervals = (target, range) => {
  const diff = range[1] - range[0]
  const order = 10 ** Math.floor(Math.log10(diff)) / 5
  const n = Math.ceil(diff / order)

  for (let t = n; t < n + 6; t++) {
    const factors = []
    for (let i = 1; i <= Math.sqrt(t); i++) {
      if (t % i === 0) {
        factors.push(i, t / i)
      }
    }

    let best = 1
    for (const factor of factors) {
      if (factor <= target && factor > best) {
        best = factor
      }
    }

    if (best > 1) {
      const niceMin = Math.floor(range[0] / order) * order
      return [best, [niceMin, niceMin + t * order]]
    }
  }

  return [target, range]
}

const numberToString = (n, max) =>
  String(Number(n.toPrecision(1 + Math.floor(Math.abs(Math.log10(max))))))

/**
 * ```
 *        4 |       *
 *        3 |
 *        2 | *
 *        1 |____*___
 *            A  B  C
 * ```
 *
 * There is margin above and to the right of the chart, to avoid markes being clipped
 * There is margin between the axis and the labels
 * There is margin between the labels and the left and bottom of the chart
 */
const LineChart = ({ className, data, height, width }) => {
  // TODO
  // multiple series (by color)

  // constants
  const FONTSIZE = 11
  const LINESPACING = 1.2
  const MARKER = 4
  const MARGIN = 8

  // determine size needed, or allowed, for x-axis labels
  const axisHeight = Math.min(
    0.4 * height,
    Math.max(...data.category.map((cat) => measureText(cat) / Math.sqrt(2)))
  )

  // determine plot area height
  const h = height - 3 * MARGIN - axisHeight

  // determine size needed, or allowed, for y-axis labels
  const range = [Math.min(0, ...data.value), Math.max(...data.value)]
  const targetIntervals = Math.min(10, Math.floor((h / FONTSIZE) * LINESPACING)) // Based on how much space I have, but no more than 10
  const [niceIntervals, [niceMin, niceMax]] = findNiceIntervals(
    targetIntervals,
    range
  )
  const axisValues = Array.from(
    { length: niceIntervals + 1 },
    (_, i) => niceMin + ((niceMax - niceMin) * i) / niceIntervals
  )

  const axisWidth = Math.min(
    0.4 * width,
    Math.max(
      ...axisValues.map((val) =>
        measureText(numberToString(val, niceMax - niceMin))
      )
    )
  )

  // determine plot area width
  const w = width - 3 * MARGIN - axisWidth
  const dx = w / data.value.length
  const toX = (i) => (i + 0.5) * dx

  // construct y-axis labels
  const sy = h / (niceMax - niceMin)
  const toY = (val) => h - (val - niceMin) * sy
  const ylabels = axisValues.flatMap((val) => [
    [
      "line",
      {
        stroke: "#aaaaaa",
        x1: 0,
        y1: toY(val),
        x2: -MARGIN / 2,
        y2: toY(val),
      },
    ],
    [
      "text",
      {
        "font-family": "Arial",
        "font-size": `${FONTSIZE}px`,
        "text-anchor": "end",
        transform: `translate(${-MARGIN} ${toY(val) + 0.3 * FONTSIZE})`,
      },
      numberToString(val, niceMax - niceMin),
    ],
  ])

  // construct x-axis labels
  let categoryMod = 1
  while (
    categoryMod < data.category.length &&
    Math.ceil(data.category.length / categoryMod) * FONTSIZE * LINESPACING > w
  ) {
    categoryMod++
  }

  const xlabels = data.category.flatMap((cat, i) => {
    const tick = [
      "line",
      {
        stroke: "#aaaaaa",
        x1: (i + 1) * dx,
        y1: h,
        x2: (i + 1) * dx,
        y2: h + MARGIN / 2,
      },
    ]

    if (i % categoryMod !== 0) {
      return [tick]
    }

    const truncated = truncateText(cat, axisHeight * Math.sqrt(2))

    return [
      tick,
      [
        "text",
        {
          "font-family": "Arial",
          "font-size": `${FONTSIZE}px`,
          "text-anchor": "end",
          transform: `translate(${toX(i) + 0.3 * FONTSIZE} ${
            h + MARGIN
          }) rotate(-45)`,
          x: 0,
          y: 0,
        },
        truncated ?? cat,
      ],
    ]
  })

  const markers = data.value.flatMap((val, i, arr) => {
    const x = toX(i)
    const y = toY(val)

    const line =
      i + 1 === arr.length
        ? []
        : [
            [
              "line",
              {
                stroke: "#888888",
                x1: x,
                y1: y,
                x2: toX(i + 1),
                y2: toY(arr[i + 1]),
              },
            ],
          ]

    return [
      ...line,
      [
        "circle",
        {
          cx: x,
          cy: y,
          fill: data.color[i],
          r: MARKER,
        },
        ...(!data.title ? [] : [["title", {}, data.title[i]]]),
      ],
    ]
  })

  const valueLabels = !data.label
    ? []
    : data.label.map((label, i) => [
        "text",
        {
          "font-family": "Arial",
          "font-size": FONTSIZE,
          "paint-order": "stroke",
          stroke: "#ffffff",
          "stroke-width": 2,
          "text-anchor": "middle",
          x: toX(i),
          y: toY(data.value[i]) - FONTSIZE / 2,
        },
        label,
      ])

  return [
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      className,
      viewBox: `0 0 ${width} ${height}`,
      "ov-hint": "svg-image",
    },
    ["rect", { x: 0, y: 0, width, height, fill: "none", stroke: "#dddddd" }],
    [
      "g",
      {
        transform: `translate(${MARGIN + axisWidth + MARGIN}, ${MARGIN})`,
      },
      // y-axis
      [
        "line",
        {
          stroke: "#888888",
          x1: 0,
          y1: 0,
          x2: 0,
          y2: h,
        },
      ],
      // x-axis
      [
        "line",
        {
          stroke: "#888888",
          x1: 0,
          y1: h,
          x2: w,
          y2: h,
        },
      ],
      ...ylabels,
      ...xlabels,
      ...markers,
      ...valueLabels,
    ],
  ]
}

const PieChart = ({ data, height, measure, width }) => {
  const FONT_SIZE = 11

  const total = sum(data[measure])
  const das = data[measure].map((val) => 360 * (val / total))
  const angles = das.reduce(
    (r, da) => {
      r.angles.push(r.acc)

      r.acc += da

      return r
    },
    {
      acc: 0,
      angles: [],
    }
  ).angles

  const size = Math.min(width, height) / 2
  const radius = 0.7 * size

  const segments = angles.map((angle, index) => [
    "path",
    {
      d: `M 0 0 L 0 ${-radius} A ${radius} ${radius} 0 ${
        das[index] > 180 ? 1 : 0
      } 1 ${radius * Math.sin(rad(das[index]))} ${
        -radius * Math.cos(rad(das[index]))
      }`,
      fill: PALETTE[index % PALETTE.length],
      "with-drag": {
        type: "bucket",
        dragImage: [
          "div",
          {
            class: "drag-image",
          },
          `🪣 ${data.colorBy[index]}`,
        ],
        bucketKey: data.colorBy[index],
        color: PALETTE[index % PALETTE.length],
      },
      transform: `translate(${width / 2} ${height / 2}) rotate(${angle})`,
      stroke: "white",
    },
  ])

  const [left, right] = angles.reduce(
    (r, angle, index) => {
      const a = angle + das[index] / 2
      const x = width / 2 + (radius + 20) * Math.sin(rad(a))
      const y = height / 2 - (radius + 20) * Math.cos(rad(a))

      if (a > 180) {
        r[0].unshift({
          index,
          textAnchor: "end",
          x,
          y,
        })
      } else {
        r[1].push({
          index,
          textAnchor: "start",
          x,
          y,
        })
      }

      return r
    },
    [[], []]
  )

  const prune = (xs) => {
    while (xs.length > 0 && FONT_SIZE * xs.length > height) {
      let smallest = 0
      for (let i = 1; i < xs.length; i += 1) {
        if (das[xs[i].index] <= das[xs[smallest].index]) {
          smallest = i
        }
      }

      xs.splice(smallest, 1)
    }
  }

  prune(left)
  prune(right)

  const distribute = (xs, sx) => {
    let max = 32
    while (
      max > 0 &&
      xs.some(
        ({ y }, i) =>
          y < 0 ||
          y + FONT_SIZE > height ||
          (i !== 0 && xs[i - 1].y > y - FONT_SIZE)
      )
    ) {
      const spacing = (height - xs.length * FONT_SIZE) / (xs.length - 1)
      for (let j = 0; j < xs.length; j += 1) {
        const newY = j * (FONT_SIZE + spacing) + FONT_SIZE
        xs[j].y = 0.9 * xs[j].y + 0.1 * newY
        xs[j].x =
          width / 2 +
          sx *
            (radius + 20) *
            Math.sqrt(1 - ((xs[j].y - height / 2) / (height / 2)) ** 2)
      }

      max -= 1
    }
  }

  distribute(left, -1)
  distribute(right, 1)

  const labels = [...left, ...right].flatMap(({ index, textAnchor, x, y }) => {
    const canvas = document.createElement("canvas")
    const g = canvas.getContext("2d")
    g.font = `${FONT_SIZE}px Arial`
    const w = textAnchor === "end" ? x : width - x
    const label = data.colorBy[index]
    let len = label.length
    while (
      len > 3 &&
      g.measureText(
        len === label.length ? label : label.substring(0, len) + "..."
      ).width > w
    ) {
      len -= 1
    }

    const text = len === label.length ? label : label.substring(0, len) + "..."

    const x1 = x + (textAnchor === "end" ? 4 : -4)
    const y1 = y - 0.4 * FONT_SIZE
    const x2 =
      width / 2 + radius * Math.sin(rad(angles[index] + das[index] / 2))
    const y2 =
      height / 2 - radius * Math.cos(rad(angles[index] + das[index] / 2))

    return [
      [
        "text",
        {
          "font-family": "Arial",
          "font-size": FONT_SIZE,
          "text-anchor": textAnchor,
          x,
          y,
        },
        ...(len === label.length ? [] : [["title", {}, label]]),
        text,
      ],
      [
        "path",
        {
          d: `M ${x1} ${y1} L ${0.8 * x1 + 0.2 * x2} ${y1} L ${x2} ${y2}`,
          fill: "none",
          stroke: "#888888",
        },
      ],
    ]
  })

  return ["svg", { height, width }, ...segments, ...labels]
}

const Scroller = withSize(
  ({ children, itemHeight, items, scrollLens, state, size }) => {
    const scrollTop = view(state, grind(...scrollLens)) ?? 0

    const start = Math.floor(scrollTop / itemHeight)

    const end = Math.min(
      items.length,
      start + Math.ceil((size?.[1] ?? 300) / itemHeight)
    )
    const sub = []
    for (let i = start; i < end; i += 1) {
      sub.push(children[0]({ index: i, item: items[i] }))
    }

    return [
      "div",
      {
        "with-scroll": { lens: scrollLens },
        scrollTop,
        style: {
          "overflow-y": "scroll",
          width: "100%",
        },
      },
      [
        "div",
        {
          style: {
            height: `${itemHeight * (items.length + 1)}px`,
            "overflow-y": "hidden",
            position: "relative",
            width: "100%",
          },
        },
        [
          "div",
          {
            style: {
              left: "0px",
              position: "absolute",
              top: `${scrollTop}px`,
            },
          },
          ...sub,
        ],
      ],
    ]
  }
)

const data = {
  colorBy: [
    "Admin",
    "Distribution",
    "Executive",
    "Finance",
    "HR",
    "IT Programme Delivery",
    "Operations",
    "Ops Programme Delivery",
    "Programme Delivery",
    "Project Delivery",
    "Projects",
    "Sales",
    "(Blank)",
  ],
  _records__cnt: [9, 47, 3, 22, 21, 195, 1, 385, 58, 212, 282, 44, 4],
}

const App = eventHandlers(
  ({ state }) => [
    VGroup,
    {},
    ["h2", {}, "Welcome ", [Editable, { state, lens: ["user"] }], "!"],

    [
      "div",
      { style: { width: 600, height: 400 } },
      [
        LineChart,
        {
          data: {
            color: data["_records__cnt"].map(
              (_, i) => PALETTE[i % PALETTE.length]
            ),
            category: data["colorBy"],
            label: data["_records__cnt"].map((val) => String(val)),
            title: data["_records__cnt"].map(
              (val, i) =>
                `colorBy: ${data["colorBy"][i]}\nTotal records: ${val}`
            ),
            value: data["_records__cnt"],
          },
          height: 400 / 1,
          width: 600 / 1,
        },
      ],
    ],

    [
      HGroup,
      {},
      [
        "div",
        { style: { width: 600, height: 400 } },
        [
          PieChart,
          {
            data,
            height: 400 / 1,
            measure: "_records__cnt",
            width: 600 / 1,
          },
        ],
      ],

      [Blob, { color: state.color, drd: "with-drop" }],
    ],

    !state.showItems
      ? [Button, { label: "Show items", onClick: { reason: "show-items" } }]
      : [List, { lazyItems: state.lazyItems, state }],

    [Button, { label: "Footer", onClick: { reason: "footer-click" } }],
    !state.showWindow
      ? null
      : [
          Window,
          {
            id: "riscos",
            onClose: { reason: "footer-click" },
            title: "RISC-OS",
          },
          "Two households, both alike in dignity",
          ["br", {}],
          "(In fair Verona, where we lay our scene),",
          ["br", {}],
          "From ancient grudge break to new mutiny,",
          ["br", {}],
          "Where civil blood makes civil hands unclean.",
          ["br", {}],
          "From forth the fatal loins of these two foes",
          ["br", {}],
          "A pair of star-crossed lovers take their life.",
        ],
    [
      Canvas,
      { width: 100, height: 100 },
      [
        "svg",
        {},
        ["rect", { x: 10, y: 10, width: 80, height: 80, fill: "red" }],
      ],
    ],
  ],
  {
    drop: (state, event) => ({
      ...state,
      color: event.source.color,
    }),
    "footer-click": (state) => ({
      ...state,
      showWindow: !state.showWindow,
    }),
    "show-items": (state) => ({
      ...state,
      showItems: true,
    }),
  }
)

const loadItems = async (itemCount) => {
  await sleep(1000)

  return new Array(itemCount)
    .fill(1)
    .map(() => Math.random().toString(16).substring(2))
}

const init = eval("(" + (window.location.search.substring(7) || "{}") + ")")
const app = createApp({
  color: "white",
  lazyItems: memoPromise(() => loadItems(5e5)),
  user: "Nicolette",
  ...init,
})
