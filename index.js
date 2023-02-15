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

const sum = (xs, f) => xs.reduce((r, x) => r + (f ? f(x) : x), 0)

const PieChart = ({ data, height, measure, width }) => {
  const total = sum(data[measure])
  const radius = Math.min(width, height) / 2

  let a = 0

  return [
    "svg",
    { height, width },
    ...data[measure].map((val, i) => {
      const da = (360 * val) / total

      const t = [
        "path",
        {
          d: `M 0 0 L 0 ${-radius} A ${radius} ${radius} 0 ${
            da > 180 ? 1 : 0
          } 1 ${radius * Math.sin((Math.PI * da) / 180)} ${
            -radius * Math.cos((Math.PI * da) / 180)
          }`,
          fill: PALETTE[i % PALETTE.length],
          "with-drag": {
            type: "bucket",
            dragImage: [
              "div",
              {
                class: "drag-image",
              },
              `🪣 ${data.colorBy[i]}`,
            ],
            bucketKey: data.colorBy[i],
            color: PALETTE[i % PALETTE.length],
          },
          transform: `translate(${radius} ${radius}) rotate(${a})`,
          stroke: "white",
        },
      ]

      a += da

      return t
    }),
  ]
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

const App = eventHandlers(
  ({ state }) => [
    VGroup,
    {},
    ["h2", {}, "Welcome ", [Editable, { state, lens: ["user"] }], "!"],

    [
      HGroup,
      {},
      [
        "div",
        { style: { width: 200, height: 200 } },
        [
          PieChart,
          {
            data: {
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
              _records__cnt: [
                9, 47, 3, 22, 21, 195, 1, 385, 58, 212, 282, 44, 4,
              ],
            },
            height: 200,
            measure: "_records__cnt",
            width: 200,
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
