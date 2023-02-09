const createReducible = (reduce) => ({
    reduce,
    [Symbol.iterator]: function* () {
        yield* reduce((r, x) => {
            r.push(x);
            return r;
        }, []);
    },
});
export const compose = (...fs) => {
    return (x) => {
        let r = x;
        for (let i = fs.length - 1; i >= 0; i -= 1) {
            r = fs[i](r);
        }
        return r;
    };
};
/**
 * Conjoin. Returns a new collection with the xs 'added'.
 */
export const conj = (coll, ...xs) => {
    return new Set([...coll, ...xs]);
};
export const count = (coll) => coll.reduce((r) => r + 1, 0);
export const createUid = () => Math.random().toString(16).slice(2);
/**
 * Disjoin. Returns a new collection with the xs 'removed'.
 */
export const disj = (set, ...keys) => {
    const r = new Set(set);
    for (const key of keys) {
        r.delete(key);
    }
    return r;
};
/**
 * Disassociate. Returns a new object without the specified keys.
 */
export const dissoc = (obj, ...keys) => {
    const r = {};
    for (const key in obj) {
        if (keys.indexOf(key) === -1) {
            r[key] = obj[key];
        }
    }
    return r;
};
export const filter = (p, coll) => createReducible((step, init) => coll.reduce((r, x) => (p(x) ? step(r, x) : r), init));
export const identity = (x) => x;
/**
 * Returns the intersection of two sets.
 */
export const intersection = (s1, s2) => {
    const r = new Set();
    for (const x of s1) {
        if (s2.has(x)) {
            r.add(x);
        }
    }
    return r;
};
export const map = (f, coll) => createReducible((step, init) => {
    const t = coll.reduce
        ? coll
        : Object.entries(coll);
    return t.reduce((r, x) => step(r, f(x)), init);
});
/**
 * Returns a memoized function, optionally with hash creating function.
 */
export const memo = (f, getHash) => {
    const cache = {};
    return (...args) => {
        const hash = getHash ? getHash(args) : JSON.stringify(args);
        if (!(hash in cache)) {
            cache[hash] = f(...args);
        }
        return cache[hash];
    };
};
/**
 * Returns a memoized Thunks.
 */
export const memoPromise = (thunk) => {
    const cache = [];
    return async () => {
        if (cache.length) {
            return cache[0];
        }
        return await thunk().then((r) => {
            cache[0] = r;
            return r;
        });
    };
};
/**
 * Race multiple async iterables.
 */
export const race = (...iterables) => ({
    [Symbol.asyncIterator]: async function* () {
        const iterators = iterables.map((iter) => iter[Symbol.asyncIterator]());
        const values = await Promise.all(iterators.map((iterator) => iterator.next().then((n) => n.value)));
        yield values;
        const promises = iterators.map((iterator, i) => iterator.next().then((n) => [n.value, i]));
        while (true) {
            const [value, i] = await Promise.race(promises);
            values[i] = value;
            promises[i] = iterators[i].next().then((n) => [n.value, i]);
            yield values;
        }
    },
});
/**
 * Returns a reducibles of integers from start (inclusive) to end (exclusive).
 */
export const range = (a, b) => createReducible((step, init) => {
    let r = init;
    let i = a;
    while (b === undefined || i < b) {
        r = step(r, i);
        i += 1;
    }
    return r;
});
/**
 * Returns a Promise that sleeps for ms milliseconds.
 */
export const sleep = (ms) => new Promise((res, rej) => {
    setTimeout(() => {
        res(undefined);
    }, ms);
});
/**
 * Return result of threading initial value through a series of functions.
 */
export const thread = (x, ...fs) => fs.reduce((x, f) => f(x), x);
/**
 * Returns the union of two sets.
 */
export const union = (s1, s2) => new Set([...s1, ...s2]);
