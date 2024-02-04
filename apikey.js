const fs = require('fs')
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
    const now = new Date()
    const expiryDate = new Date(now)
    if (keys[key].DeviceID.length < keys[key].limitDevice) {
        if (keys[key].DeviceID.includes(ip) === false && keys[key].DeviceID.length >= keys[key].limitDevice) {
            return res.json({ "error": "Giới hạn thiết bị ." })
        }
        if (keys[key].expiryDate === null && keys[key].DeviceID == []) {
            expiryDate.setDate(now.getDate() + keys[key].days)
            keys[key].DeviceID.push(ip)
            jsonObject = keys
            jsonObject[key].expiryDate = expiryDate
            jsonObject[key].DeviceID = keys[key].DeviceID
            WriteJson(jsonObject)
            return res.json({ "success": "Đã thêm ngày hết hạn và thiết bị." })
        }
        else {
            keys[key].DeviceID.push(ip)
            WriteJson(keys)
            return res.json({ "success": "Đã thêm thiết bị." })
        }
    }
}
function expiry(keys, key, res) {
    const now = new Date()
    if (new Date(keys[key].expiryDate) < now) {
        return res.json({ "error": "Key đã hết hạn." })
    }
    else {
        return res.json(keys[key])
    }
}


module.exports = { Device, expiry }
