# frozen_string_literal: true

require "digest"
require "json"
require "net/http"
require "securerandom"
require "time"
require "uri"

# Public API for gg-pixel error tracking.
#
#   require "gg_pixel"
#   GGPixel.init(project_key: ENV["GG_PIXEL_KEY"])
#
module GGPixel
  DEFAULT_INGEST_URL = "https://gg-pixel-server.buzzbeamaustralia.workers.dev/ingest"
  USER_AGENT = "gg-pixel-ruby/4.3.72"

  class << self
    # Initialize the SDK. Call once at program start.
    def init(project_key:, ingest_url: DEFAULT_INGEST_URL, runtime: nil)
      raise ArgumentError, "project_key is required" if project_key.nil? || project_key.empty?
      raise "gg-pixel already initialized" if @client

      @client = Client.new(
        project_key: project_key,
        ingest_url: ingest_url,
        runtime: runtime || "ruby-#{RUBY_VERSION}",
      )
      install_at_exit_hook!
      @client
    end

    # Manual message report.
    def report(message, level: :error)
      return unless @client
      @client.report(message: message, level: level)
    end

    # Capture an exception object.
    def capture_exception(exception, level: :error)
      return unless @client
      @client.capture_exception(exception, level: level)
    end

    # Tear down the SDK.
    def close
      @client = nil
    end

    private

    # at_exit fires on every program exit. Ruby sets `$!` to the unhandled
    # exception that caused the exit (if any). We capture it synchronously
    # so it lands before the process tears down.
    def install_at_exit_hook!
      return if @at_exit_installed
      @at_exit_installed = true
      at_exit do
        exc = $! # rubocop:disable Style/SpecialGlobalVars
        if exc && !exc.is_a?(SystemExit) && @client
          @client.capture_exception(exc, level: :fatal, manual: false)
        end
      end
    end
  end
end

require "gg_pixel/client"
