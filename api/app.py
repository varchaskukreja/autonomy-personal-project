from web.app import app, load_graph_data, graph

# Ensure heavy graph data is loaded once per serverless instance.
if graph is None:
    load_graph_data()

# Expose the Flask app for Vercel's Python runtime.
app = app
