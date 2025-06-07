module.exports = function (RED) {
    // Define node for querying data from InfluxDB
    function InfluxDBHTTPQueryNode(config) {
        RED.nodes.createNode(this, config);
        this.influxConfig = RED.nodes.getNode(config.influxConfig);
        this.table = config.table || "Undefined";
        this.defaultTimeSpan = parseInt(config.defaultTimeSpan) || 604800;
        const node = this;

        node.on("input", function (msg) {
            // Validate InfluxDB configuration
            if (!node.influxConfig) {
                node.error("No InfluxDB configuration defined", msg);
                return;
            }

            try {
                // Validate token
                const token = node.influxConfig.token;
                if (!token) {
                    node.error("No token provided in InfluxDB configuration", msg);
                    return;
                }

                // Use msg.table if provided, else use configured table
                const table = msg.table || node.table;
                if (!table || table === "Undefined") {
                    node.error("No valid table specified", msg);
                    return;
                }

                // Determine time span
                let timeSpan;
                if (Number.isInteger(parseInt(msg.timeSpan))) {
                    timeSpan = parseInt(msg.timeSpan);
                } else if (
                    msg.req &&
                    msg.req.query &&
                    Number.isInteger(parseInt(msg.req.query.timeSpan))
                ) {
                    timeSpan = parseInt(msg.req.query.timeSpan);
                } else {
                    timeSpan = node.defaultTimeSpan;
                }

                // Validate time span
                if (timeSpan <= 0) {
                    node.error("Invalid timeSpan: Must be a positive integer", msg);
                    return;
                }

                // Construct SQL query for specific table
                const query = `SELECT * FROM "${table}" WHERE time >= now() - INTERVAL '${timeSpan} SECOND' ORDER BY time`;

                // Configure HTTP request
                const isV3 = node.influxConfig.version === "3";
                const endpoint = isV3 ? "/api/v3/query_sql" : "/api/v2/query";
                const params = `db=${encodeURIComponent(node.influxConfig.database)}&q=${encodeURIComponent(query)}&format=json`;
                msg.url = `http://${node.influxConfig.host}:${node.influxConfig.port}${endpoint}?${params}`;
                msg.method = "GET";
                msg.headers = {
                    Authorization: isV3 ? `Bearer ${token}` : `Token ${token}`,
                      "Content-Type": "application/json",
                      Accept: "application/json"
                };
                msg.payload = null;
                msg.bucket = table;
                msg.timeSpan = timeSpan;
                msg.timeout = config.timeout || 30000;

                // Send the message to the next node
                node.send(msg);
            } catch (e) {
                node.error(`Failed to prepare request: ${e.message}`, msg);
            }
        });
    }
    RED.nodes.registerType("influxdb-http-query", InfluxDBHTTPQueryNode);
};