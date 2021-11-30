const mqtt = require('mqtt')

var argv = require('yargs/yargs')(process.argv.slice(2))
    .options({
        'access-token': {
            alias: 't',
            describe: 'Device access token',
            demandOption: true
        }
    })
    .help()
    .argv

var client  = mqtt.connect('mqtt://thingsboard.cloud',{
    username: argv.accessToken
})

client.on('connect', function () {
    client.subscribe('v1/devices/me/attributes/response/+')
    client.publish('v1/devices/me/attributes/request/1', '{"clientKeys":"recentAvgSpeed"}')
})

client.on('message', function (topic, message) {
    messageData = JSON.parse(message.toString())
    console.log(`Recent avg speed from ThingsBoard: ${messageData.client.recentAvgSpeed}`)
})
