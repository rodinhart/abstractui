import { range, sleep } from "./lib/lang.js"
import { grind, over, view } from "./lib/lenses.js"

/*

TODOs

with-size isn't essential state
what about lazy loading mutable data?
allow namespaced plugin of event handlers
define serializable lenses?
clean up metalui, dejavue etc.
DnD
Progress bar
DOM-diff performance

*/

// Set node values, attribute and event handlers.
const attributesǃ = (node, props, onEventǃ) => {
  const measures = []
  for (const [key, val] of Object.entries(props)) {
    switch (key) {
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
          onEventǃ({ ...val, reason: "window-handle" }, rawEvent)
        requestAnimationFrame(() => {
          const ancestor = document.getElementById(val.windowId)
          const bounds = ancestor.getBoundingClientRect()
          ancestor.style.left = (document.body.offsetWidth - bounds.width) / 2
          ancestor.style.top = (document.body.offsetHeight - bounds.height) / 2
        })
        break

      case "with-scroll":
        node.onscroll = (rawEvent) =>
          onEventǃ({ ...val, reason: "with-scroll" }, rawEvent)
        break

      case "with-size":
        measures.push({
          ...val,
          node,
          properties: ["offsetWidth", "offsetHeight"],
        })
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

  return measures
}

// Create a new app
const createApp = (initialState) => {
  let state
  let prev = []
  let withPosition

  const onEventǃ = async (event, rawEvent) => {
    switch (event.reason) {
      case "footer-click":
        state = {
          ...state,
          showWindow: !state.showWindow,
        }
        break

      case "init":
        state = initialState
        break

      case "with-measures":
        {
          let changedState = state
          for (const { lens, node, properties } of event.measures) {
            const values = properties.map((p) => node[p])
            if (!eqal(view(changedState, grind(...lens)), values)) {
              changedState = over(changedState, grind(...lens), () => values)
            }
          }

          if (changedState !== state) {
            state = changedState
          } else {
            return
          }
        }
        break

      case "window-handle":
        {
          const ancestor = document.getElementById(event.windowId)
          const bounds = ancestor.getBoundingClientRect()
          withPosition = (clientX, clientY) => {
            ancestor.style.left = bounds.x + clientX - rawEvent.clientX
            ancestor.style.top = bounds.y + clientY - rawEvent.clientY
          }
        }
        return

      case "with-scroll":
        state = over(
          state,
          grind(...event.lens),
          () => rawEvent.target.scrollTop
        )
        break

      case "Editable/edit-user":
        state = over(state, grind(...event.lens), (value) => ({
          _edit: true,
          tmp: value,
        }))
        break

      case "Editable/update-user":
        state = over(state, grind(...event.lens), (value) => value.tmp)
        break

      case "Editable/user-input":
        state = over(state, grind(...event.lens), (value) => ({
          ...value,
          tmp: rawEvent.target.value
            .split(/\s+/)
            .filter((w) => w)
            .map((w) => `${w[0].toUpperCase()}${w.substring(1)}`)
            .join(" "),
        }))
        break

      default:
        console.warn(`Unknown event ${event.reason}`)
        return
    }

    // console.log("render", state)
    const tmp = await render([App, { state }])
    const measures = domǃ(document.getElementById("app"), tmp, prev, {
      onEventǃ,
    })
    prev = tmp
    await onEventǃ({ reason: "with-measures", measures })
  }

  window.addEventListener("resize", () => {
    onEventǃ({
      reason: "with-measures",
      measures: [
        {
          lens: ["_dummy"],
          node: document.body,
          properties: ["offsetWidth", "offsetHeight"],
        },
      ],
    })
  })

  window.addEventListener("mousemove", (rawEvent) => {
    if (withPosition) {
      withPosition(rawEvent.clientX, rawEvent.clientY)
    }
  })

  window.addEventListener("mouseup", () => {
    withPosition = undefined
  })

  onEventǃ({ reason: "init" })
}

// Update DOM with differences from prev to els.
const domǃ = (target, els, prev, { ns, onEventǃ }) => {
  const measures = []
  for (let i = 0; i < els.length; i += 1) {
    const el = els[i]
    if (Array.isArray(el)) {
      // element node
      const [tag, props, ...children] = el
      if (!Array.isArray(prev[i]) || prev[i][0] !== tag) {
        // new
        if (tag === "svg") {
          ns = "http://www.w3.org/2000/svg"
        }
        const node = !ns
          ? document.createElement(tag)
          : document.createElementNS(ns, tag)
        measures.push(...attributesǃ(node, props, onEventǃ))

        if (i >= target.childNodes.length) {
          target.appendChild(node)
        } else {
          target.replaceChild(node, target.childNodes[i])
        }

        measures.push(...domǃ(node, children, [], { ns, onEventǃ }))
      } else {
        // update
        const node = target.childNodes[i]

        // removed attributes
        for (const key of Object.keys(prev[i][1])) {
          if (props[key] === undefined) {
            node.removeAttribute(key)
          }
        }

        // update attributes
        measures.push(
          ...attributesǃ(
            node,
            Object.fromEntries(
              Object.entries(props).filter(
                ([key, val]) =>
                  key === "with-size" || !eqal(val, prev[i][1][key])
              )
            ),
            onEventǃ
          )
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
const render = async (el) => {
  if (Array.isArray(el)) {
    const [tag, props, ...children] = el

    if (typeof tag === "function") {
      return render(await tag({ ...props, children }))
    }

    let mapped = []
    for (const child of children) {
      const tmp = await render(child)
      mapped = [...mapped, ...tmp]
    }

    return tag !== "fragment" ? [[tag, props, ...mapped]] : mapped
  }

  return el !== null ? [String(el)] : []
}

// Primitives
const Button = ({ label, onClick }) => ["button", { onClick }, label]

const Fragment = ({ children }) => ["fragment", {}, ...children]

const HGroup = ({ children }) => [
  "div",
  {
    style: { display: "flex" },
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

// Components

const memo = (f) => {
  const cache = {}

  return async (...args) => {
    const hash = JSON.stringify(args)
    if (!cache[hash]) {
      cache[hash] = f(...args)
    }

    return cache[hash]
  }
}

const loadItems = memo(async (itemCount) => {
  // await sleep(2000)

  return new Array(itemCount)
    .fill(1)
    .map(() => Math.random().toString(16).substring(2))
})

const Editable = ({ state, lens }) => {
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
}

const List = async ({ itemCount, state }) => {
  const items = await loadItems(itemCount)

  return [
    Scroller,
    {
      itemHeight: 15,
      items,
      scrollLens: ["scrollTop"],
      sizeLens: ["scrollSize"],
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

const Scroller = ({
  children,
  itemHeight,
  items,
  scrollLens,
  sizeLens,
  state,
}) => {
  const scrollTop = view(state, grind(...scrollLens)) ?? 0
  const size = view(state, grind(...sizeLens))

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
      "with-size": { lens: sizeLens },
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

const App = ({ state }) => [
  VGroup,
  {},
  ["h2", {}, "Welcome ", [Editable, { state, lens: ["user"] }], "!"],
  [List, { itemCount: state.itemCount, state }],
  [
    "div",
    { style: { height: "100px" } },
    [
      "svg",
      { width: 200, height: 100 },
      [
        "rect",
        { x: 10, y: 10, width: 80, height: 80, stroke: "black", fill: "green" },
      ],
      [
        "rect",
        {
          x: 110,
          y: 10,
          width: 80,
          height: 80,
          stroke: "black",
          fill: "white",
        },
      ],
    ],
  ],
  [Button, { label: "Footer", onClick: { reason: "footer-click" } }],
  !state.showWindow
    ? null
    : [
        Window,
        { id: "riscos", onClose: { reason: "footer-click" }, title: "RISC-OS" },
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
]

const app = createApp({
  itemCount: 5e5,
  user: "Nicolette",
})
