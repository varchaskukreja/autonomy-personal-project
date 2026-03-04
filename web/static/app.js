// -- project final

import { Simulator } from './simulator.js';

const AppState = {
    LANDING: 'LANDING',
    RUNNING: 'RUNNING',
    ARRIVED: 'ARRIVED'
};

let currentState = AppState.LANDING;
const simulator = new Simulator();

const landingView = document.getElementById('landingView');
const simulatorRoot = document.getElementById('simulatorRoot');
const arrivalOverlay = document.getElementById('arrivalOverlay');
const exitJourneyBtn = document.getElementById('exitJourneyBtn');
const simulatorContainer = document.getElementById('container');

function setState(nextState) {
    currentState = nextState;
    if (landingView) landingView.classList.toggle('hidden', nextState !== AppState.LANDING);
    if (simulatorRoot) simulatorRoot.classList.toggle('hidden', nextState === AppState.LANDING);
    if (arrivalOverlay) arrivalOverlay.classList.toggle('hidden', nextState !== AppState.ARRIVED);
    document.body.classList.toggle('sim-running', nextState !== AppState.LANDING);
}

function startSimulation() {
    setState(AppState.RUNNING);
    simulator.start({ container: simulatorContainer });
}

function exitSimulation() {
    simulator.stop();
    setState(AppState.LANDING);
}

simulator.on('destinationReached', () => {
    setState(AppState.ARRIVED);
});

if (exitJourneyBtn) {
    exitJourneyBtn.addEventListener('click', exitSimulation);
}

setState(AppState.LANDING);

// Autocomplete functionality
let autocompleteTimeout = null;

function setupAutocomplete(inputId, suggestionsId) {
    const input = document.getElementById(inputId);
    const suggestionsDiv = document.getElementById(suggestionsId);
    let selectedIndex = -1;

    input.addEventListener('input', function() {
        const query = this.value.trim();
        
        // Clear previous timeout
        if (autocompleteTimeout) {
            clearTimeout(autocompleteTimeout);
        }

        // Hide suggestions if query is too short
        if (query.length < 3) {
            suggestionsDiv.classList.remove('show');
            return;
        }

        // Debounce API calls
        autocompleteTimeout = setTimeout(() => {
            fetchAutocomplete(query, suggestionsDiv, input);
        }, 300);
    });

    input.addEventListener('keydown', function(e) {
        const items = suggestionsDiv.querySelectorAll('.suggestion-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
            updateSelection(items, selectedIndex);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, -1);
            updateSelection(items, selectedIndex);
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            if (items[selectedIndex]) {
                items[selectedIndex].click();
            }
        } else if (e.key === 'Escape') {
            suggestionsDiv.classList.remove('show');
            selectedIndex = -1;
        }
    });

    // Hide suggestions when clicking outside
    document.addEventListener('click', function(e) {
        if (!input.contains(e.target) && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.classList.remove('show');
        }
    });
}

function updateSelection(items, index) {
    items.forEach((item, i) => {
        if (i === index) {
            item.style.backgroundColor = '#e0e0e0';
        } else {
            item.style.backgroundColor = '';
        }
    });
}

async function fetchAutocomplete(query, suggestionsDiv, input) {
    try {
        const response = await fetch(`/autocomplete?q=${encodeURIComponent(query)}`);
        const suggestions = await response.json();

        if (response.ok && Array.isArray(suggestions)) {
            displaySuggestions(suggestions, suggestionsDiv, input);
        } else {
            suggestionsDiv.classList.remove('show');
        }
    } catch (error) {
        console.error('Autocomplete error:', error);
        suggestionsDiv.classList.remove('show');
    }
}

function displaySuggestions(suggestions, suggestionsDiv, input) {
    suggestionsDiv.innerHTML = '';

    if (suggestions.length === 0) {
        suggestionsDiv.classList.remove('show');
        return;
    }

    suggestions.forEach(suggestion => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';
        item.textContent = suggestion.display_name;
        
        item.addEventListener('click', function() {
            input.value = suggestion.display_name;
            suggestionsDiv.classList.remove('show');
        });

        suggestionsDiv.appendChild(item);
    });

    suggestionsDiv.classList.add('show');
}

// Form submission and route computation
document.getElementById('routeForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const startAddress = document.getElementById('startAddress').value.trim();
    const endAddress = document.getElementById('endAddress').value.trim();

    if (!startAddress || !endAddress) {
        showError('Please enter both start and end addresses');
        return;
    }

    // Hide previous results and errors
    document.getElementById('results').classList.add('hidden');
    document.getElementById('error').classList.add('hidden', 'show');
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('simulateBtn').disabled = true;

    try {
        // Step 1: Get lat/lon and nearest nodes
        const latlonResponse = await fetch('/get_latlon', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                start_address: startAddress,
                end_address: endAddress
            })
        });

        const latlonData = await latlonResponse.json();

        if (!latlonResponse.ok) {
            throw new Error(latlonData.error || 'Failed to geocode addresses');
        }

        // Step 2: Compute route
        const routeResponse = await fetch('/compute_route', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                start_node: latlonData.start.node_id,
                end_node: latlonData.end.node_id
            })
        });

        const routeData = await routeResponse.json();

        if (!routeResponse.ok) {
            throw new Error(routeData.error || 'Failed to compute route');
        }

        // Display results
        displayResults(latlonData, routeData);
        
        // Store route data for simulator autopilot
        if (routeData.waypoints && routeData.waypoints.length > 0) {
            const routePayload = {
                waypoints: routeData.waypoints,
                start_address: startAddress,
                end_address: endAddress,
                distance: routeData.distance,
                num_nodes: routeData.num_nodes
            };
            localStorage.setItem('autopilot_route', JSON.stringify(routePayload));
            console.log('Route stored for autopilot:', routePayload);
        }

    } catch (error) {
        console.error('Route computation error:', error);
        showError(error.message || 'An error occurred while computing the route');
    } finally {
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('simulateBtn').disabled = false;
    }
});

function displayResults(latlonData, routeData) {
    const resultsDiv = document.getElementById('results');
    const statusDiv = document.getElementById('statusMessage');

    // Status message with simulator launch button
    statusDiv.innerHTML = `
        <strong>✅ Route computed successfully!</strong><br>
        Ready to launch the simulator.<br><br>
        <button id="launchSimulatorBtn" class="btn-primary" style="margin-top: 10px;">
            🚗 Launch Simulator & Start Autopilot
        </button>
    `;
    
    // Add click handler for simulator launch button
    document.getElementById('launchSimulatorBtn').addEventListener('click', function() {
        startSimulation();
    });

    resultsDiv.classList.remove('hidden');
}

function showError(message) {
    const errorDiv = document.getElementById('error');
    errorDiv.textContent = `Error: ${message}`;
    errorDiv.classList.remove('hidden');
    errorDiv.classList.add('show');
}

// Initialize autocomplete for both inputs
setupAutocomplete('startAddress', 'startSuggestions');
setupAutocomplete('endAddress', 'endSuggestions');

// Random Route functionality using /api/random_locations
const randomRouteBtn = document.getElementById('randomRouteBtn');
if (randomRouteBtn) {
    randomRouteBtn.addEventListener('click', async function () {
        const resultsDiv = document.getElementById('results');
        const errorDiv = document.getElementById('error');
        const loadingDiv = document.getElementById('loading');
        const simulateBtn = document.getElementById('simulateBtn');

        // Hide previous results and errors, show loading
        if (resultsDiv) resultsDiv.classList.add('hidden');
        if (errorDiv) {
            errorDiv.classList.add('hidden', 'show');
        }
        if (loadingDiv) loadingDiv.classList.remove('hidden');
        if (simulateBtn) simulateBtn.disabled = true;
        randomRouteBtn.disabled = true;

        try {
            // Step 1: Fetch two random valid road nodes
            const randomResp = await fetch('/api/random_locations');
            const randomData = await randomResp.json();

            if (!randomResp.ok || !randomData.success) {
                throw new Error(randomData.error || 'Failed to get random locations');
            }

            const start = randomData.start;
            const end = randomData.end;

            // Optionally populate the address fields with the random locations
            const startInput = document.getElementById('startAddress');
            const endInput = document.getElementById('endAddress');
            if (startInput && endInput) {
                startInput.value = start.display_name;
                endInput.value = end.display_name;
            }

            // Build a latlon-like structure to reuse displayResults
            const latlonData = {
                start: {
                    address: start.display_name,
                    node_id: start.node_id,
                    lat: start.lat,
                    lon: start.lon
                },
                end: {
                    address: end.display_name,
                    node_id: end.node_id,
                    lat: end.lat,
                    lon: end.lon
                }
            };

            // Step 2: Compute route between these nodes
            const routeResponse = await fetch('/compute_route', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    start_node: start.node_id,
                    end_node: end.node_id
                })
            });

            const routeData = await routeResponse.json();

            if (!routeResponse.ok) {
                throw new Error(routeData.error || 'Failed to compute route for random locations');
            }

            // Display results using existing UI
            displayResults(latlonData, routeData);

            // Store route data for simulator autopilot
            if (routeData.waypoints && routeData.waypoints.length > 0) {
                const routePayload = {
                    waypoints: routeData.waypoints,
                    start_address: latlonData.start.address,
                    end_address: latlonData.end.address,
                    distance: routeData.distance,
                    num_nodes: routeData.num_nodes
                };
                localStorage.setItem('autopilot_route', JSON.stringify(routePayload));
                console.log('Random route stored for autopilot:', routePayload);
            }
        } catch (error) {
            console.error('Random route error:', error);
            showError(error.message || 'An error occurred while generating a random route');
        } finally {
            if (loadingDiv) loadingDiv.classList.add('hidden');
            if (simulateBtn) simulateBtn.disabled = false;
            randomRouteBtn.disabled = false;
        }
    });
}
