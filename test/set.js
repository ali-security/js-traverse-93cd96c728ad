var test = require('tape');
var traverse = require('../');

var has = Object.prototype.hasOwnProperty;

var protoDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__');
// where `__proto__` is an accessor, an own `__proto__` data property can be created;
// where it is magic, it can not, and a `__proto__` segment throws instead
var hasOwnProto = !!(protoDescriptor && typeof protoDescriptor.set === 'function');

var hasSymbols = typeof Symbol === 'function' && typeof Symbol('s') === 'symbol';
var bigint = typeof BigInt === 'function' ? BigInt(42) : null;
var hasProxy = typeof Proxy === 'function';

var setPrototypeOf = Object.setPrototypeOf || function (obj, proto) {
    obj.__proto__ = proto;
};

var builtins = [
    { name : 'Object.prototype', value : Object.prototype },
    { name : 'Function.prototype', value : Function.prototype },
    { name : 'Array.prototype', value : Array.prototype },
    { name : 'String.prototype', value : String.prototype },
    { name : 'Number.prototype', value : Number.prototype },
    { name : 'Boolean.prototype', value : Boolean.prototype },
    { name : 'Number', value : Number },
    { name : 'Number.prototype.toString', value : Number.prototype.toString }
].concat(
    hasSymbols ? { name : 'Symbol.prototype', value : Symbol.prototype } : [],
    bigint !== null ? { name : 'BigInt.prototype', value : Object.getPrototypeOf(Object(bigint)) } : []
);

function getState () {
    var state = [];
    for (var i = 0; i < builtins.length; i++) {
        state[i] = {
            names : Object.getOwnPropertyNames(builtins[i].value),
            proto : Object.getPrototypeOf(builtins[i].value)
        };
    }
    return state;
}

// reverts as it reports, so that a failure here can not cascade into the tests that run after it
function undoPollution (state) {
    var pollution = [];
    for (var i = 0; i < builtins.length; i++) {
        var builtin = builtins[i].value;
        var names = Object.getOwnPropertyNames(builtin);
        for (var j = 0; j < names.length; j++) {
            if (state[i].names.indexOf(names[j]) < 0) {
                pollution.push(builtins[i].name + ' gained `' + names[j] + '`');
                delete builtin[names[j]];
            }
        }
        if (Object.getPrototypeOf(builtin) !== state[i].proto) {
            pollution.push(builtins[i].name + ' has a different [[Prototype]]');
            setPrototypeOf(builtin, state[i].proto);
        }
    }
    return pollution;
}

function getOwnProto (obj) {
    var desc = Object(obj) === obj && Object.getOwnPropertyDescriptor(obj, '__proto__');
    return desc ? desc.value : undefined;
}

// this tape's t.throws only checks that something was thrown, not what
function throwsTypeError (t, fn, msg) {
    var caught;
    try { fn() }
    catch (err) { caught = err }
    t.ok(caught instanceof TypeError, msg);
}

test('set', function (t) {
    var state = getState();

    var obj = { a : { b : 1 }, c : [ 1, 2 ] };

    t.equal(traverse(obj).set([ 'a', 'b' ], 2), 2, 'returns the value');
    t.deepEqual(obj, { a : { b : 2 }, c : [ 1, 2 ] }, 'replaces an existing value');

    var a = obj.a;
    traverse(obj).set([ 'a', 'd', 'e' ], 3);
    t.equal(obj.a, a, 'keeps the existing nodes on the path');
    t.deepEqual(obj, { a : { b : 2, d : { e : 3 } }, c : [ 1, 2 ] }, 'creates the missing nodes on the path');

    traverse(obj).set([ 'c', 1 ], 4);
    traverse(obj).set([ 'c', 2, 0 ], 5);
    t.deepEqual(obj, { a : { b : 2, d : { e : 3 } }, c : [ 1, 4, { 0 : 5 } ] }, 'sets array indexes');

    t.equal(traverse.set(obj, [ 'f', 'g' ], 6), 6, 'static form returns the value');
    t.deepEqual(obj.f, { g : 6 }, 'static form sets the value');

    var inherited = {};
    traverse(inherited).set([ 'constructor', 'prototype', 'polluted' ], 'yes');
    t.ok(has.call(inherited, 'constructor'), 'an inherited key is created as an own property');
    // compared as JSON: this tape's deepEqual treats an own `prototype` key as the function `.prototype`
    t.equal(JSON.stringify(inherited.constructor), '{"prototype":{"polluted":"yes"}}', 'an inherited value is not descended into');
    t.ok(!('polluted' in Object.prototype), 'Object.prototype is not polluted');

    throwsTypeError(t, function () { traverse({ a : 1 }).set([ 'a', 'b', 'c' ], 2) }, 'a path that crosses a primitive throws');
    throwsTypeError(t, function () { traverse({ a : 1 }).set([ 'a', 'b' ], 2) }, 'a path that ends on a primitive throws');
    throwsTypeError(t, function () { traverse({ a : 1 }).set([ 'a', 0 ], 2) }, 'a path that ends on a primitive, with an index, throws');

    t.deepEqual(undoPollution(state), [], 'no built-in is modified');

    if (hasSymbols) {
        var sym = Symbol('s');
        var symObj = {};

        t.equal(traverse(symObj).set([ sym, sym ], 1), 1, 'symbols: returns the value');
        t.ok(has.call(symObj, sym), 'symbols: creates the missing nodes on the path');
        t.equal(traverse(symObj).get([ sym, sym ]), 1, 'symbols: sets the value');

        var boxed = {};
        traverse(boxed).set([ Object(sym) ], 2);
        t.equal(boxed[sym], 2, 'symbols: a boxed symbol segment is used as that symbol');
    }
    else {
        t.ok(true, 'symbols: skipped, this engine has no symbols');
    }

    t.end();
});

test('set coerces each path segment once', function (t) {
    var state = getState();

    var calls = 0;
    var segment = {
        toString : function () {
            calls += 1;
            return calls > 1 ? '__proto__' : 'a';
        }
    };
    var obj = { a : {} };

    traverse(obj).set([ segment, 'polluted' ], 'yes');

    t.equal(calls, 1, 'segment is coerced once');
    t.deepEqual(obj, { a : { polluted : 'yes' } }, 'the same key is used throughout');
    t.deepEqual(undoPollution(state), [], 'no built-in is modified');
    t.end();
});

test('set with a __proto__ segment', function (t) {
    if (!hasOwnProto) {
        t.ok(true, 'skipped, `__proto__` can not be an own property in this engine');
        t.end();
        return;
    }
    var state = getState();

    var obj = {};
    t.equal(traverse(obj).set([ '__proto__', 'x' ], 1), 1, 'returns the value');
    t.deepEqual(
        Object.getOwnPropertyDescriptor(obj, '__proto__'),
        {
            configurable : true,
            enumerable : true,
            value : { x : 1 },
            writable : true
        },
        'creates an enumerable, writable, configurable own `__proto__`'
    );
    t.deepEqual(Object.keys(obj), [ '__proto__' ], 'own `__proto__` is the only key');
    t.equal(Object.getPrototypeOf(obj), Object.prototype, '[[Prototype]] is unchanged');
    t.ok(!('x' in obj), 'does not inherit from the `__proto__` value');
    t.equal(traverse(obj).get([ '__proto__', 'x' ]), 1, 'get finds the value');
    t.equal(traverse(obj).has([ '__proto__', 'x' ]), true, 'has finds the value');

    var value = { isAdmin : true };
    var last = { a : {} };
    traverse(last).set([ 'a', '__proto__' ], value);
    t.equal(getOwnProto(last.a), value, 'as the last segment, sets an own `__proto__`');
    t.equal(Object.getPrototypeOf(last.a), Object.prototype, 'as the last segment, [[Prototype]] is unchanged');
    t.ok(!('isAdmin' in last.a), 'as the last segment, does not inherit from the value');
    t.equal(traverse(last).get([ 'a', '__proto__' ]), value, 'as the last segment, get finds the value');

    var only = {};
    traverse(only).set([ '__proto__' ], value);
    t.equal(getOwnProto(only), value, 'as the only segment, sets an own `__proto__`');
    t.equal(Object.getPrototypeOf(only), Object.prototype, 'as the only segment, [[Prototype]] is unchanged');

    var repeated = {};
    traverse(repeated).set([ '__proto__', '__proto__', 'x' ], 1);
    var nested = getOwnProto(repeated);
    t.deepEqual(getOwnProto(nested), { x : 1 }, 'repeated, creates nested own `__proto__`s');
    t.equal(Object.getPrototypeOf(repeated), Object.prototype, 'repeated, [[Prototype]] is unchanged');
    t.equal(Object(nested) === nested && Object.getPrototypeOf(nested), Object.prototype, 'repeated, nested [[Prototype]] is unchanged');
    t.equal(traverse(repeated).get([ '__proto__', '__proto__', 'x' ]), 1, 'repeated, get finds the value');

    var coerced = {};
    traverse(coerced).set([ [ '__proto__' ], 'x' ], 1);
    t.deepEqual(getOwnProto(coerced), { x : 1 }, 'coerced from an object, creates an own `__proto__`');
    t.equal(Object.getPrototypeOf(coerced), Object.prototype, 'coerced from an object, [[Prototype]] is unchanged');

    var coercedLast = { a : {} };
    traverse(coercedLast).set([ 'a', [ '__proto__' ] ], value);
    t.equal(getOwnProto(coercedLast.a), value, 'coerced from an object, as the last segment, sets an own `__proto__`');
    t.equal(
        Object.getPrototypeOf(coercedLast.a),
        Object.prototype,
        'coerced from an object, as the last segment, [[Prototype]] is unchanged'
    );

    var parsed = JSON.parse('{"__proto__":{"a":1}}');
    var existing = getOwnProto(parsed);
    traverse(parsed).set([ '__proto__', 'b' ], 2);
    t.equal(getOwnProto(parsed), existing, 'an existing own `__proto__` is kept');
    t.deepEqual(existing, { a : 1, b : 2 }, 'an existing own `__proto__` is descended into');
    traverse(parsed).set([ '__proto__' ], 3);
    t.equal(getOwnProto(parsed), 3, 'an existing own `__proto__` is replaced');
    t.equal(Object.getPrototypeOf(parsed), Object.prototype, 'with an existing own `__proto__`, [[Prototype]] is unchanged');

    var viaStatic = {};
    t.equal(traverse.set(viaStatic, [ '__proto__', 'x' ], 1), 1, 'static form returns the value');
    t.deepEqual(getOwnProto(viaStatic), { x : 1 }, 'static form creates an own `__proto__`');
    t.equal(Object.getPrototypeOf(viaStatic), Object.prototype, 'static form leaves the [[Prototype]] unchanged');

    function Foo () {}
    var targets = [
        { name : 'instance', value : new Foo, proto : Foo.prototype },
        { name : 'array', value : [], proto : Array.prototype },
        { name : 'function', value : function () {}, proto : Function.prototype },
        { name : 'boxed string', value : Object('x'), proto : String.prototype },
        { name : 'null object', value : Object.create(null), proto : null }
    ];
    for (var i = 0; i < targets.length; i++) {
        traverse(targets[i].value).set([ '__proto__', 'x' ], 1);
        t.deepEqual(getOwnProto(targets[i].value), { x : 1 }, targets[i].name + ' gets an own `__proto__`');
        t.equal(Object.getPrototypeOf(targets[i].value), targets[i].proto, targets[i].name + ' keeps its [[Prototype]]');
    }

    throwsTypeError(t, function () {
        traverse(Object.freeze({})).set([ '__proto__', 'x' ], 1);
    }, 'a non-extensible object throws');

    t.deepEqual(undoPollution(state), [], 'no built-in is modified');
    t.end();
});

test('set with a __proto__ segment, where it can not be an own property', function (t) {
    if (hasOwnProto) {
        t.ok(true, 'skipped, `__proto__` can be an own property in this engine');
        t.end();
        return;
    }
    var state = getState();

    var value = { isAdmin : true };
    var owner = {};
    Object.defineProperty(owner, '__proto__', {
        configurable : true,
        enumerable : true,
        value : {},
        writable : true
    });
    var targets = [
        {},
        { a : {} },
        [],
        owner
    ];
    var paths = [
        [ '__proto__' ],
        [ '__proto__', 'polluted' ],
        [ 'a', '__proto__' ],
        [ 'a', '__proto__', 'polluted' ],
        [ [ '__proto__' ], 'polluted' ]
    ];

    for (var i = 0; i < targets.length; i++) {
        var proto = Object.getPrototypeOf(targets[i]);
        for (var j = 0; j < paths.length; j++) {
            (function (target, path, label) {
                // `[ 'a', ... ]` paths on a target without `a` create it first, then hit `__proto__`
                throwsTypeError(t, function () { traverse(target).set(path, value) }, label + ': throws');
            })(targets[i], paths[j], 'target ' + i + ', path ' + j);
            t.equal(Object.getPrototypeOf(targets[i]), proto, 'target ' + i + ', path ' + j + ': [[Prototype]] is unchanged');
        }
    }
    t.equal(Object.getPrototypeOf(targets[1].a), Object.prototype, 'nested [[Prototype]] is unchanged');
    t.deepEqual(value, { isAdmin : true }, 'value is not modified');

    t.deepEqual(undoPollution(state), [], 'no built-in is modified');
    t.end();
});

test('set does not pollute built-in prototypes', function (t) {
    var state = getState();

    var cases = [
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', '__proto__', 'polluted' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', '__proto__', '__proto__', 'polluted' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', '__proto__' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', [ '__proto__' ], 'polluted' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', 'length', '__proto__', 'polluted' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', 0, '__proto__', 'polluted' ] },
        { target : JSON.parse('{"name":"bob"}'), path : [ 'name', 'constructor', 'prototype', 'polluted' ] },
        { target : { n : 1 }, path : [ 'n', '__proto__', 'polluted' ] },
        { target : { n : 1 }, path : [ 'n', '__proto__', '__proto__', 'polluted' ] },
        { target : { n : 1 }, path : [ 'n', 'constructor', 'prototype', 'polluted' ] },
        { target : { n : 1 }, path : [ 'n', 'constructor', 'polluted' ] },
        { target : { n : 1 }, path : [ 'n', 'toString', 'polluted' ] },
        { target : { b : true }, path : [ 'b', '__proto__', 'polluted' ] },
        { target : { b : true }, path : [ 'b', '__proto__', '__proto__', 'polluted' ] },
        { target : [], path : [ 'length', '__proto__', 'polluted' ] },
        { target : function () {}, path : [ 'length', '__proto__', 'polluted' ] },
        { target : 'x', path : [ '__proto__', 'polluted' ] },
        { target : 'x', path : [ '__proto__', '__proto__', 'polluted' ] },
        { target : 'x', path : [ '__proto__' ] },
        { target : 'x', path : [ 'constructor', 'prototype', 'polluted' ] },
        { target : 1, path : [ '__proto__', 'polluted' ] },
        { target : true, path : [ '__proto__', 'polluted' ] }
    ].concat(
        hasSymbols ? [
            { target : Symbol('s'), path : [ '__proto__', 'polluted' ] },
            { target : { s : Symbol('s') }, path : [ 's', '__proto__', 'polluted' ] },
            { target : { s : Symbol('s') }, path : [ 's', '__proto__', '__proto__', 'polluted' ] }
        ] : [],
        bigint !== null ? [
            { target : bigint, path : [ '__proto__', 'polluted' ] },
            { target : { g : bigint }, path : [ 'g', '__proto__', 'polluted' ] },
            { target : { g : bigint }, path : [ 'g', '__proto__', '__proto__', 'polluted' ] }
        ] : []
    );
    var value = { isAdmin : true };

    for (var i = 0; i < cases.length; i++) {
        (function (c, label) {
            throwsTypeError(t, function () { traverse(c.target).set(c.path, value) }, label + ': throws');
            t.deepEqual(undoPollution(state), [], label + ': no built-in is modified');
            throwsTypeError(t, function () { traverse.set(c.target, c.path, value) }, label + ': static form throws');
            t.deepEqual(undoPollution(state), [], label + ': static form modifies no built-in');
        })(cases[i], 'case ' + i);
    }

    t.deepEqual(value, { isAdmin : true }, 'value is not modified');
    t.end();
});

test('set does not follow an accessor that a primitive inherits', function (t) {
    var inherited = {};
    Object.defineProperty(Number.prototype, 'inherited', {
        configurable : true,
        get : function () { return inherited },
        set : function () {}
    });
    var state = getState();

    throwsTypeError(t, function () {
        traverse({ n : 1 }).set([ 'n', 'inherited', 'polluted' ], 'yes');
    }, 'throws');
    t.deepEqual(inherited, {}, 'the inherited value is not modified');
    throwsTypeError(t, function () {
        traverse({ n : 1 }).set([ 'n', 'inherited' ], 'yes');
    }, 'throws when it is the last segment');
    t.deepEqual(undoPollution(state), [], 'no built-in is modified');

    delete Number.prototype.inherited;
    t.end();
});

test('set does not descend into a property it could not create', function (t) {
    var state = getState();

    var shared = {};
    var calls = [];
    function Config () {}
    Object.defineProperty(Config.prototype, 'defaults', {
        configurable : true,
        get : function () { return shared },
        set : function (x) { calls.push(x) }
    });

    throwsTypeError(t, function () {
        traverse(new Config).set([ 'defaults', 'polluted' ], 'yes');
    }, 'an inherited accessor in the middle of the path throws');
    t.deepEqual(shared, {}, 'the inherited value is not modified');

    var config = new Config;
    t.equal(traverse(config).set([ 'defaults' ], 'yes'), 'yes', 'an inherited accessor as the last segment returns the value');
    t.deepEqual(calls.slice(-1), [ 'yes' ], 'an inherited accessor as the last segment is still assigned to');
    t.ok(!has.call(config, 'defaults'), 'an inherited accessor as the last segment creates no own property');

    if (hasProxy) {
        var ignoresSet = new Proxy({}, {
            set : function () { return true }
        });
        throwsTypeError(t, function () {
            traverse(ignoresSet).set([ 'constructor', 'prototype', 'polluted' ], 'yes');
        }, 'Proxy: a target that ignores assignment throws');
        throwsTypeError(t, function () {
            traverse({ a : ignoresSet }).set([ 'a', 'constructor', 'prototype', 'polluted' ], 'yes');
        }, 'Proxy: a nested target that ignores assignment throws');

        var ignoresDefine = new Proxy({}, {
            defineProperty : function () { return true }
        });
        throwsTypeError(t, function () {
            traverse(ignoresDefine).set([ '__proto__', 'polluted' ], 'yes');
        }, 'Proxy: a target that ignores a property definition throws');
    }
    else {
        t.ok(true, 'Proxy: skipped, this engine has no Proxy');
    }

    t.deepEqual(undoPollution(state), [], 'no built-in is modified');
    t.end();
});
