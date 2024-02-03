const fs = require('fs')
const now = new Date()
path = 'key.json'
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
function Device(keys, key, ip, res) {
    if (keys[key].DeviceID.length < keys[key].limitDevice) {
        if (keys[key].DeviceID.includes(ip) === false && keys[key].DeviceID.length >= keys[key].limitDevice) {
            res.json({ "error": "Giới hạn thiết bị ." })
        }
        else {
            keys[key].DeviceID.push(ip)
            res.json({ "success": "Đã thêm thiết bị." })
            WriteJson(keys)
        }
    }
    if (keys[key].expiryDate === null && keys[key].DeviceID.length == 0) {
        expiryDate.setDate(currentDate.getDate() + keys[key].days);
        jsonObject = keys
        jsonObject[key].expiryDate = expiryDate
        WriteJson(jsonObject)
        res.json({ "success": "Đã thêm ngày hết hạn và thiết bị." })
    }
}
function expiry(keys, key, res) {
    if (new Date(keys[key].expiryDate) < now) {
        res.json({ "error": "Key đã hết hạn." })
    }
}


module.exports = { Device, expiry }
