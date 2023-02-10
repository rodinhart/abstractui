> ### abstract
>
> _adjective_ \
> existing in thought or as an idea but not having a physical or concrete existence.
>
> _verb_ \
> extract or remove (something).
>
> _origin_ \
> abstractus: drawn away

# abstractui

![diagram](diagram.excalidraw.png)

**state** holds the application's essential state, including things like scroll position

**markup** is produced by rendering the state. The render function is pure.

**DOM** is updated by comparing the markup to the previous version of the markup. Only differences are written to the DOM.

**with-position** hooks up the relevant events to allow movable elements (such as a window). It updates DOM directly.

**measures** hooks up the relevant events to allow components to respond element measures (such as width and height).

**onEvent** takes any events, updates the state and triggers a rerender cycle.
