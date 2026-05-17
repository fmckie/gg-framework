# gg_pixel (Ruby)

Ruby SDK for gg-pixel error tracking. Same wire format as the JS, Python,
Go, Rust, Swift, and Workers SDKs.

## Install

```bash
gem install gg_pixel
```

Or in a Gemfile:

```ruby
gem "gg_pixel"
```

## Use

```ruby
require "gg_pixel"

GGPixel.init(project_key: ENV["GG_PIXEL_KEY"])

# Anything uncaught after this point is reported on exit.

begin
  risky!
rescue => e
  GGPixel.capture_exception(e)
end

GGPixel.report("user clicked the broken button")
```

`init` installs an `at_exit` hook that captures any unhandled exception
that propagated out of the program — so a true uncaught error lands in
your gg-pixel queue before the process exits.
