import { range } from "./lib/lang.js"
import { grind, over, view } from "./lib/lenses.js"

/*

TODOs
only use HGroup etc, no divs
allow namespaced plugin of event handlers
define serializable lenses?
clean up metalui, dejavue etc.
(async)
DnD

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

  const onEventǃ = (event, rawEvent) => {
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

    const tmp = render([App, { state }])
    const measures = domǃ(document.getElementById("app"), tmp, prev, onEventǃ)
    prev = tmp
    onEventǃ({ reason: "with-measures", measures })
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
const domǃ = (target, els, prev, onEventǃ) => {
  const measures = []
  for (let i = 0; i < els.length; i += 1) {
    const el = els[i]
    if (Array.isArray(el)) {
      // element node
      const [tag, props, ...children] = el
      if (!Array.isArray(prev[i]) || prev[i][0] !== tag) {
        // new
        const node = document.createElement(tag)
        measures.push(...attributesǃ(node, props, onEventǃ))

        if (i >= target.childNodes.length) {
          target.appendChild(node)
        } else {
          target.replaceChild(node, target.childNodes[i])
        }

        measures.push(...domǃ(node, children, [], onEventǃ))
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
        measures.push(...domǃ(node, children, prev[i].slice(2), onEventǃ))
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

  if (typeof a !== typeof b || typeof a !== "object") {
    return false
  }

  if (a instanceof Date) {
    return a.getTime() === b.getTime()
  }

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false
    }

    return a.every((x, i) => eqal(x, b[i]))
  }

  // objects
  if (Array.isArray(b)) {
    return false
  }

  const keys = Object.keys(a)
  if (Object.keys(b).length !== keys.length) {
    // assumes no values of undefined
    return false
  }

  return keys.every((key) => eqal(a[key], b[key]))
}

// Render dsl to html
const render = (el) => {
  if (Array.isArray(el)) {
    const [tag, props, ...children] = el

    if (typeof tag === "function") {
      return render(tag({ ...props, children }))
    }

    const mapped = children.flatMap((child) => render(child))

    return tag !== "fragment" ? [[tag, props, ...mapped]] : mapped
  }

  return el !== null ? [String(el)] : []
}

// Components

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

const Fragment = ({ children }) => ["fragment", {}, ...children]

const List = ({ items, state }) => [
  Scroller,
  { itemHeight: 15, items, state },
  ({ index, item }) => [
    "div",
    {
      style: {
        display: "flex",
      },
    },
    ["div", { style: { width: "200px" } }, `${index + 1}. `, item],
    ...[...range(0, 14)].map((c) => [
      "div",
      { style: { width: "150px" } },
      item.substring(0, c) + item.substring(c + 1),
    ]),
  ],
]

const Scroller = ({ children, itemHeight, items, state }) => {
  const start = Math.floor((state.scrollTop ?? 0) / itemHeight)

  const end = Math.min(
    items.length,
    start + Math.ceil((state.scrollSize?.[1] ?? 300) / itemHeight)
  )
  const sub = []
  for (let i = start; i < end; i += 1) {
    sub.push(children[0]({ index: i, item: items[i] }))
  }

  return [
    "div",
    {
      "with-size": { lens: ["scrollSize"] },
      "with-scroll": { lens: ["scrollTop"] },
      scrollTop: state.scrollTop,
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
            top: `${state.scrollTop ?? 0}px`,
          },
        },
        ...sub,
      ],
    ],
  ]
}

const App = ({ state }) => [
  "div",
  {
    style: {
      "align-items": "start",
      display: "flex",
      "flex-direction": "column",
      height: "100%",
    },
  },
  ["h2", {}, "Welcome ", [Editable, { state, lens: ["user"] }], "!"],
  [List, { items: state.items, state }],
  [
    "button",
    { onClick: { reason: "footer-click" }, style: { "margin-top": "10px" } },
    "Footer",
  ],
  !state.showWindow
    ? null
    : [
        "div",
        {
          id: "riscos",
          class: "window",
        },
        [
          "div",
          { class: "window__div" },
          [
            "div",
            {
              class: "window-title",
              "window-handle": { windowId: "riscos" },
            },
            ["div", {}, "RISC-OS"],
            [
              "div",
              {
                onClick: { reason: "footer-click" },
                style: { cursor: "pointer", position: "relative", top: "-3px" },
              },
              "🗙",
            ],
          ],
        ],
        [
          "div",
          { class: "window-body" },
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
      ],
]

const app = createApp({
  items: new Array(5e5)
    .fill(1)
    .map(() => Math.random().toString(16).substring(2)),
  user: "Nicolette",
})
