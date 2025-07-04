module.exports = function(RED) {
    // Define node for writing line protocol data to InfluxDB
    function InfluxDBOutputHttpWriteNode(config) {
        RED.nodes.createNode(this, config);
        this.influxConfig = RED.nodes.getNode(config.influxConfig);
        this.tags = config.tags || "";
        const node = this;

        node.on('input', function(msg) {
            // Validate InfluxDB configuration
            if (!node.influxConfig) {
                node.error("No InfluxDB configuration defined", msg);
                return;
            }
            // Validate payload as an array of line protocol strings
            if (!Array.isArray(msg.payload)) {
                node.error("Invalid payload: Expected array of line protocol strings", msg);
                return;
            }

            try {
                // Validate token
                const token = node.influxConfig.token;
                if (!token) {
                    node.error("No token provided in InfluxDB configuration", msg);
                    return;
                }

                // Validate and clean line protocol strings
                const lines = msg.payload.filter(line => {
                    if (typeof line !== 'string') {
                        node.warn(`Invalid line type: ${typeof line}, value: ${JSON.stringify(line)}`);
                        return false;
                    }
                    const trimmedLine = line.trim();
                    // Regex allows escaped spaces, commas, or equals signs in measurement
                    if (!trimmedLine.match(/^(?:[^, =\\]+|\\[, =])+\svalue=[0-9.]+ [0-9]+$/)) {
                        node.warn(`Invalid line format: ${trimmedLine}`);
                        return false;
                    }
                    return true;
                });

                // Check if any valid lines remain
                if (lines.length === 0) {
                    node.error("No valid line protocol strings in payload", msg);
                    return;
                }

                // Add extra tags if specified
                let extraTags = '';
                if (node.tags) {
                    const tagPairs = node.tags.split(',')
                        .map(s => s.trim())
                        .filter(tag => tag)
                        .map((tag, index) => `tag_${index}=${tag.replace(/[, =]/g, '\\$&')}`)
                        .join(',');
                    if (tagPairs) {
                        extraTags = `,${tagPairs}`;
                    }
                }

                // Append extra tags to lines
                const taggedLines = extraTags ? lines.map(line => {
                    const parts = line.trim().split(' ');
                    const timestamp = parts.pop();
                    const [measurement, fields] = parts.join(' ').split(/ (?=value=)/);
                    return `${measurement}${extraTags} ${fields} ${timestamp}`.trim();
                }) : lines;

                // Configure HTTP request
                const isV3 = node.influxConfig.version === '3';
                const endpoint = isV3 ? '/api/v3/write_lp' : '/api/v2/write';
                const params = isV3
                    ? `db=${node.influxConfig.database}`
                    : `org=${node.influxConfig.org}&bucket=${node.influxConfig.database}&precision=ns`;
                msg.url = `http://${node.influxConfig.host}:${node.influxConfig.port}${endpoint}?${params}`;
                msg.method = 'POST';
                msg.headers = {
                    'Authorization': isV3 ? `Bearer ${token}` : `Token ${token}`,
                    'Content-Type': 'text/plain; charset=utf-8'
                };
                msg.payload = taggedLines.join('\n');
                msg.timeout = config.timeout || 5000;

                // Send the message to the next node
                node.send(msg);
            } catch (e) {
                node.error(`Failed to process or send request: ${e.message}`, msg);
            }
        });
    }
    RED.nodes.registerType("influxdb-output-http-write", InfluxDBOutputHttpWriteNode);
};