import osmium
import matplotlib.pyplot as plt

#This script was essentially just a test, to make sure my fremont OSM was working and downloaded BOTH
#ways and buildings.

class MapHandler(osmium.SimpleHandler): 
    """This class is used to extract roads and buildings from OSM data.
    # It is a subclass of osmium.SimpleHandler, which is a base class for all OSM handlers."""
    
    def __init__(self):
        super().__init__() #required for proper inheritance stuff (technicality)
        self.nodes = {}  # Store node coordinates by ID (dictionary)
        self.highways = []  # Store highway ways as lists of node IDs (list)
        self.buildings = []  # Store building ways as lists of node IDs (list)
        self.highway_node_ids = []  # Store node ID lists for highways (list)
        self.building_node_ids = []  # Store node ID lists for buildings (list)
    
    def node(self, n):
        """This method is called for each node in the OSM data.
        # It stores the node coordinates by ID in the self.nodes dictionary, by longitude and latitude. """
        self.nodes[n.id] = (n.location.lon, n.location.lat) 
    
    def way(self, w):
        """ Get node IDs for this way (list of node IDs) """
        node_ids = [node.ref for node in w.nodes]
        
        if 'highway' in w.tags: #check if it's a highway
            self.highway_node_ids.append(node_ids)
        if 'building' in w.tags: #check if it's a building
            self.building_node_ids.append(node_ids)
    
    def get_highway_coordinates(self):
        """Convert highway node IDs to coordinates, helper method."""
        highways = []
        for node_ids in self.highway_node_ids:
            coords = []
            for node_id in node_ids:
                if node_id in self.nodes:
                    coords.append(self.nodes[node_id])
            if len(coords) > 1:  # Only add if we have at least 2 points
                highways.append(coords)
        return highways
    
    def get_building_coordinates(self): 
        """Convert building node IDs to coordinates, helper method."""
        buildings = []
        for node_ids in self.building_node_ids:
            coords = []
            for node_id in node_ids:
                if node_id in self.nodes:
                    coords.append(self.nodes[node_id])
            if len(coords) > 2:  # Only add if we have at least 3 points (polygon)
                buildings.append(coords)
        return buildings


def main():
    import os
    # Load Fremont OSM data
    print("Loading OSM data...")
    handler = MapHandler()
    # Use path relative to project root
    osm_path = os.path.join(os.path.dirname(__file__), "data", "osm", "fremont_raw.osm")
    handler.apply_file(osm_path)
    
    # Extract coordinates
    print("Extracting roads and buildings...")
    highways = handler.get_highway_coordinates()
    buildings = handler.get_building_coordinates()
    
    print(f"Found {len(highways)} road segments")
    print(f"Found {len(buildings)} buildings")
    
    # Plot
    print("Creating plot...")
    plt.figure(figsize=(12, 12))
    
    # Plot buildings first (so they appear behind roads)
    for building in buildings:
        if len(building) > 0:
            lons, lats = zip(*building)
            plt.fill(lons, lats, color='lightgray', edgecolor='gray', linewidth=0.5)
    
    # Plot roads on top
    for highway in highways:
        if len(highway) > 0:
            lons, lats = zip(*highway)
            plt.plot(lons, lats, color='black', linewidth=0.5)
    
    plt.xlabel("Longitude")
    plt.ylabel("Latitude")
    plt.title("Fremont Roads & Buildings")
    plt.grid(True, alpha=0.3)
    plt.axis('equal')
    plt.tight_layout()
    
    print("Displaying plot...")
    plt.show()


if __name__ == "__main__":
    main()

