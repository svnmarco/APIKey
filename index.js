const now = new Date()
const getIP = require('ipware')().get_ip
const express = require('express');
const app = express();
const port = process.env.PORT || 3000
const fs = require('fs')
const path = 'key.json'
const currentDate = new Date();
const expiryDate = new Date(currentDate);
const { Device, expiry } = require('./apikey.js')
function ReadJson() {
    open = fs.readFileSync(path)
    jsonObject = JSON.parse(open)
    return jsonObject
}
function WriteJson(jsonObject) {
    fs.writeFile(path, JSON.stringify(jsonObject, null, 4), err => {
        console.log()
    })
}
function randomString(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}
app.get('/', (req, res) => {
    var key = req.query.key
    var ip = getIP(req)
    var ip = ip.clientIp
    var keys = ReadJson()
    if (keys[key]) {
        Device(keys, key, ip, res)
        expiry(keys, key, res)
    }
    else {
        res.json({ "error": 404 })
    }
})
app.get('/add', (req, res) => {
    res.sendFile(__dirname + '/add.html')
    key = randomString(10)
    var { days, limitDevice, type } = req.query
    jsonObject = ReadJson()
    if (type === "free") {
        jsonObject[key] = {
            limitDevice: + limitDevice,
            DeviceID: [],
            days: + days,
            expiryDate: null,
            type: type
        }
        WriteJson(jsonObject)
        res.json({ "success": key })
    }
})
app.listen(port, () => {
    console.log(` http://localhost:${port}`);
});