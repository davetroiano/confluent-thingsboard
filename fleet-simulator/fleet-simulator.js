const mqtt = require('mqtt'),
    fs = require('fs'),
    jsdom = require('jsdom')

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
}
provisionFleet()

var indexes = new Array(argv.numVehicles)

var gpsData = []
var speed = 40,
    status = "On route"



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
    stopTime = -5
    runTime = 0

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
        console.log('request.topic: ' + topic)
        console.log('request.body: ' + message.toString())
        var requestId = topic.slice('v1/devices/me/rpc/request/'.length),
            messageData = JSON.parse(message.toString())
        if (messageData.status === 'SUCCESS') {
            token = messageData.credentialsValue
            vehicleIndex = token.substr(token.length - 1)
            console.log(`Successfully provisioned ${argv.vehicleType} ${vehicleIndex}`)
        } else {
            console.warn(`Failed to provision ${argv.vehicleType}; does it already exist?`)
        }
    })
}

function publishTelemetry(client, indexes, device) {
    if (typeof gpsData === 'undefined') {
        return
    }
    console.log('client ' + device, ' indexes ' + indexes[device] + ' and ' + (indexes[device] + 1))
    console.log(gpsData[indexes[device]])
    console.log(gpsData[1 + indexes[device]])
    client.publish('v1/devices/me/telemetry', JSON.stringify({
        'longitude': gpsData[indexes[device]],
        'latitude': gpsData[indexes[device] + 1],
        "speed": speed,
        "status": status,
        "deviceType": argv.vehicleType,
        "deviceName": argv.vehicleType + ' ' + device.toString(),
        "ts": Date.now()

    }))
    stopTime++
    runTime++
    if (stopTime % 20 == 0) {
        status = "On route"
    }
    if (status == "On route") {
        speed = (40 + Math.random() * 5 + Math.random() * 20).toFixed(1)
    }
    if (runTime % 20 == 0) {
        status = "At the stop"
        speed = 0
    }
    if (status == "On route") {
        indexes[device] += 2
    }
    if (indexes[device] == gpsData.length) {
        indexes[device] = 0
    }
}
