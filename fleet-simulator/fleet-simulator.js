const mqtt = require('mqtt'),
    fs = require('fs'),
    jsdom = require('jsdom')

const STATUS_ON_ROUTE = "On route",
      STATUS_STOPPED = "Stopped"

var argv = require('yargs/yargs')(process.argv.slice(2))
    .options({
        'num-vehicles': {
            alias: 'n',
            describe: 'number of vehicles in fleet',
            demandOption: true
        },
        'vehicle-type': {
            alias: 't',
            describe: 'type of vehicle, e.g., "Truck"',
            demandOption: true
        },
        'mqtt-endpoint': {
            alias: 'm',
            describe: 'ThingsBoard mqtt endpoint',
            demandOption: false,
            default: 'thingsboard.cloud'
        },
        'token-prefix': {
            alias: 'p',
            describe: 'ThingsBoard access token prefix',
            demandOption: false
        },
        'provision-device-key': {
            alias: 'k',
            describe: 'ThingsBoard provision device key',
            demandOption: true
        },
        'provision-device-secret': {
            alias: 's',
            describe: 'ThingsBoard provision device secret',
            demandOption: true
        }
    })
    .help()
    .argv

if (typeof argv.tokenPrefix === 'undefined') {
    argv.tokenPrefix = require('crypto').randomUUID()
    console.log(`Provisining vehicles with access token prefix ${argv.tokenPrefix}`)
}

provisionFleet()

var indexes      = new Array(argv.numVehicles),
    speeds       = new Array(argv.numVehicles),
    statuses     = new Array(argv.numVehicles),
    ticksMoving  = new Array(argv.numVehicles),
    ticksStopped = new Array(argv.numVehicles)

var gpsData = []

speeds.fill(40)
statuses.fill(STATUS_STOPPED)
ticksMoving.fill(0)
ticksStopped.fill(0)

for (var i = 0; i < argv.numVehicles; i++) {
    var accessToken = argv.tokenPrefix + i.toString()
    var client = mqtt.connect(`mqtt://${argv.mqttEndpoint}`, {
        username: accessToken
    })

    data = fs.readFileSync('routes/route.kml')

    obj = new jsdom.JSDOM(data)
    coords = obj.window.document.querySelector("coordinates").textContent
    cleaned_string = coords.replace(/ /g, '').replace(/,0/g, '').replace(/(\r\n|\n|\r)/gm, ',')
    nums = cleaned_string.split(',')

    var gpsDataIndex = 0
    for (var numsIndex = 0; numsIndex < nums.length; numsIndex++) {

        if (nums[numsIndex] && nums[numsIndex].length > 0) {
            gpsData[gpsDataIndex++] = parseFloat(nums[numsIndex])
        }
    }

    indexes[i] = Math.floor(Math.random() * gpsData.length / 2) * 2

    setInterval(publishTelemetry, 1000, client, indexes, i)
}

function provisionFleet() {
    var client = mqtt.connect(`mqtt://${argv.mqttEndpoint}`, {
        username: 'provision'
    })

    client.on('connect', function() {
        console.log('Client connected!')
        for (var i = 0; i < argv.numVehicles; i++) {
            console.log(`Provisioning ${argv.vehicleType} ${i.toString()}`)

            client.publish('/provision/request', JSON.stringify({
                'deviceName': argv.vehicleType + ' ' + i.toString(),
                'provisionDeviceKey': argv.provisionDeviceKey,
                'provisionDeviceSecret': argv.provisionDeviceSecret,
                'credentialsType': 'ACCESS_TOKEN',
                'token': argv.tokenPrefix + i.toString()
            }))
        }
    })

    client.on('message', function(topic, message) {
        var requestId = topic.slice('v1/devices/me/rpc/request/'.length),
            messageData = JSON.parse(message.toString())
        if (messageData.status === 'SUCCESS') {
            token = messageData.credentialsValue
            vehicleIndex = token.substr(token.length - 1)
            console.log(`Successfully provisioned ${argv.vehicleType} ${vehicleIndex}`)
        }
    })
}

function publishTelemetry(client, indexes, device) {
    if (typeof gpsData === 'undefined') {
        return
    }

    client.publish('v1/devices/me/telemetry', JSON.stringify({
        'longitude': gpsData[indexes[device]],
        'latitude': gpsData[indexes[device] + 1],
        "speed": speeds[device],
        "status": statuses[device],
        "deviceType": argv.vehicleType,
        "deviceName": argv.vehicleType + ' ' + device.toString(),
        "ts": Date.now()

    }))

    // move unless we've been stopped for < 5 iterations or have been moving for > 20 iterations
    // (with some randomness introduced)
    if ((ticksStopped[device] > 5 && Math.random() < 0.2) ||
        (ticksMoving[device] > 0 && !(ticksMoving[device] > 20 && Math.random() < 0.1))) {

        // move vehicle along path (plus two for latitude & longitude)
        indexes[device] += 2
        if (indexes[device] == gpsData.length) {
            indexes[device] = 0
        }

        // debug log if this is a status change
        if (statuses[device] == STATUS_STOPPED) {
            console.log(`vehicle ${device} starting to move from (${gpsData[indexes[device]]}, ${gpsData[1 + indexes[device]]})`)
        }

        ticksMoving[device]++
        ticksStopped[device] = 0
        statuses[device] = STATUS_ON_ROUTE
        speeds[device] = (40 + Math.random() * 5 + Math.random() * 20).toFixed(1)
    } else {
        // debug log if this is a status change
        if (statuses[device] == STATUS_ON_ROUTE) {
            console.log(`vehicle ${device} stopped at (${gpsData[indexes[device]]}, ${gpsData[1 + indexes[device]]})`)
        }

        ticksMoving[device] = 0
        ticksStopped[device]++
        statuses[device] = STATUS_STOPPED
        speeds[device] = 0
    }
}
