var test = require('tape');
var traverse = require('../');

// this tape's t.throws only checks that something was thrown, not what
function throwsTypeError (t, fn, msg) {
    var caught;
    try { fn() }
    catch (err) { caught = err }
    t.ok(caught instanceof TypeError, msg);
}

function doesNotThrow (t, fn, msg) {
    var caught;
    try { fn() }
    catch (err) { caught = err }
    t.equal(caught, undefined, msg);
}

test('a failed assignment while walking does not throw', function (t) {
    var obj = { a : Object.freeze({ b : 1, c : [ 2 ] }) };

    doesNotThrow(t, function () {
        traverse(obj).forEach(function (x) {
            if (this.key === 'b') this.update(x + 1);
        });
    }, 'update on a frozen parent');
    t.equal(obj.a.b, 1, 'the frozen property is unchanged');

    doesNotThrow(t, function () {
        traverse(obj).forEach(function () {
            if (this.key === 'b') this.delete();
        });
    }, 'delete on a frozen parent');
    t.equal(obj.a.b, 1, 'the frozen property is still there');

    t.end();
});

test('a failed assignment in set() throws', function (t) {
    var frozen = Object.freeze({ a : 1 });

    throwsTypeError(t, function () { traverse(frozen).set([ 'a' ], 2) }, 'non-writable property');
    throwsTypeError(t, function () { traverse(frozen).set([ 'b' ], 2) }, 'new property on a frozen object');
    throwsTypeError(t, function () { traverse({ x : frozen }).set([ 'x', 'b', 'c' ], 2) }, 'intermediate property on a frozen object');
    throwsTypeError(t, function () { traverse({ s : 'str' }).set([ 's', 'length' ], 2) }, 'property of a primitive');
    t.deepEqual(frozen, { a : 1 }, 'the frozen object is unchanged');

    var sealed = Object.seal({ a : 1 });
    t.equal(traverse(sealed).set([ 'a' ], 2), 2, 'an existing writable property can still be set');
    t.equal(sealed.a, 2);

    t.end();
});
