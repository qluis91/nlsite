/**
 * Lightweight EJS layout support — no extra dependencies.
 *
 * Intercepts res.render() to detect the `layout` option.
 * Renders the view first, then wraps the result in the layout
 * as the `body` local variable.
 */
function layoutMiddleware(req, res, next) {
  const _render = res.render;

  res.render = function (view, opts, cb) {
    const layout = opts && opts.layout;

    if (layout && !opts._layoutDone) {
      const options = { ...opts };
      delete options.layout;
      options._layoutDone = true;

      const self = this;
      return _render.call(self, view, options, (err, bodyHtml) => {
        if (err) {
          if (cb) return cb(err);
          return next(err);
        }
        options.body = bodyHtml;
        return _render.call(self, layout, options, cb);
      });
    }

    return _render.call(this, view, opts, cb);
  };

  next();
}

module.exports = layoutMiddleware;
