# frozen_string_literal: true

module GGPixel
  # Internal client — wraps an HTTP sink with synchronous send.
  # Synchronous keeps fatal events reliable. For high-volume manual
  # reports, users can wrap report() / capture_exception() in their
  # own thread pool.
  class Client
    def initialize(project_key:, ingest_url:, runtime:)
      @project_key = project_key
      @ingest_url = ingest_url.chomp("/")
      @runtime = runtime
    end

    def report(message:, level:)
      stack = capture_stack(skip: 2)
      event = build_event(
        type_name: "ManualReport",
        message: message,
        stack: stack,
        manual: true,
        level: level,
      )
      send_event(event)
    end

    def capture_exception(exception, level: :error, manual: true)
      stack = parse_exception_backtrace(exception)
      event = build_event(
        type_name: exception.class.name,
        message: exception.message.to_s,
        stack: stack,
        manual: manual,
        level: level,
      )
      send_event(event)
    end

    private

    def build_event(type_name:, message:, stack:, manual:, level:)
      {
        event_id: SecureRandom.uuid,
        project_key: @project_key,
        fingerprint: fingerprint(type_name, stack),
        type: type_name,
        message: message,
        stack: stack,
        code_context: nil,
        runtime: @runtime,
        manual_report: manual,
        level: level.to_s,
        occurred_at: Time.now.utc.iso8601,
      }
    end

    def send_event(event)
      uri = URI(@ingest_url)
      req = Net::HTTP::Post.new(uri.request_uri)
      req["content-type"] = "application/json"
      req["x-pixel-key"] = @project_key
      req["user-agent"] = GGPixel::USER_AGENT
      req.body = JSON.generate(event)
      use_ssl = uri.scheme == "https"
      Net::HTTP.start(uri.hostname, uri.port, use_ssl: use_ssl, open_timeout: 3, read_timeout: 5) do |http|
        res = http.request(req)
        warn "[gg-pixel] ingest #{res.code}" if res.code.to_i >= 400
      end
    rescue => e
      warn "[gg-pixel] send failed: #{e.message}"
    end

    def capture_stack(skip: 1)
      caller_locations(skip + 1, 64).map do |loc|
        frame_from_location(loc)
      end
    end

    def parse_exception_backtrace(exception)
      locs = exception.backtrace_locations
      return capture_stack(skip: 2) if locs.nil? || locs.empty?
      locs.map { |loc| frame_from_location(loc) }
    end

    def frame_from_location(loc)
      file = loc.absolute_path || loc.path || ""
      fn = loc.label.to_s
      fn = "<anon>" if fn.empty?
      {
        file: file,
        line: loc.lineno || 0,
        col: 0,
        fn: fn,
        in_app: in_app?(file, fn),
      }
    end

    def in_app?(file, _fn)
      return false if file.nil? || file.empty?
      return false if file.include?("/gems/")
      return false if file.start_with?("(")  # (eval), (irb)
      true
    end

    def fingerprint(type_name, stack)
      top = stack.first
      normalized =
        if top
          fn = top[:fn].empty? ? "<anon>" : top[:fn]
          "#{type_name}|#{normalize_file(top[:file])}|#{fn}|#{top[:line]}"
        else
          "#{type_name}|<no-stack>"
        end
      Digest::SHA256.hexdigest(normalized)[0, 16]
    end

    def normalize_file(file)
      idx = file.index("/gems/")
      return "gems/#{file[(idx + "/gems/".length)..]}" if idx
      file
    end
  end
end
