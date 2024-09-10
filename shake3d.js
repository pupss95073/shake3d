const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline')
// const Repository = require('./Repositories/Repository')
const path = require('path');
const fs = require('fs');
const axios = require("axios");
const postJsonURL = "http://192.168.50.68:8023/upload"

const port = new SerialPort({ path: "COM10", baudRate: 115200 });
const pathToBuffer = path.join(__dirname, 'buffer.json');
const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }))

const SEND_TO_DATABASE = false;
const SAVE_IN_BUFFER = false;
const SEND_TO_SERVER = true;
let lastSensingTime = null;
// 0906
const startTimestamp = Date.now(); // Starting real-world timestamp
const startHrTime = process.hrtime.bigint(); // High-resolution time at the start

function getCalibratedSensingTime() {
    const currentHrTime = process.hrtime.bigint(); // Current high-resolution time
    const elapsedNs = currentHrTime - startHrTime; // Elapsed time in nanoseconds
    
    // Add the elapsed milliseconds to the starting timestamp
    const sensing_time = new Date(startTimestamp + Number(elapsedNs / BigInt(1e6)));
    
    return sensing_time;
}



async function sendDataToServer(apiUrl, dataJson) {
    try {
        const date = new Date();
        await axios.post(apiUrl, dataJson);

        console.log("Success at:", date);
    } catch (error) {
        console.log("Post API Error: ", error);
    }
}

function readSensorData(callback) {

    port.on('open', () => {
        console.log("Port opened");

        parser.on('data', (data) => {
            const dataStr = data.toString();  // Convert buffer to string
            const dataArray = dataStr.split(/\s*,\s*/).filter(item => item);
            // Step 2: Downsample the data (taking every 20th sample)
            const downsampledData = [];

            for (let i = 0; i < dataArray.length; i += 3) {  // origin: 60 Since there are 3 values per sample (x, y, z), skip 60 items (20 samples)
                downsampledData.push(dataArray.slice(i, i + 3));
            }

            // Step 3: Call the callback with the downsampled data
            if (callback) {
                callback(downsampledData);
            }
        });
    });
}

let index = 0;
let bufferJson = [];
let flag = 0;
// Use the reqdSensorData function

// 0906
let sensing_time = null
setInterval(() => {
    sensing_time = getCalibratedSensingTime();
}, 10); // 100Hz = 10ms interval

readSensorData((downsampledData) => {
    try {
        let uint32Data = downsampledData.map(innerArray =>
            innerArray.map(hexString => parseInt(hexString, 16))
        );


        let jsonData = {
            axis_n: uint32Data[0][0],
            axis_e: uint32Data[0][1],
            axis_z: uint32Data[0][2],
            sensing_time: sensing_time
        }
        bufferJson.push(jsonData);
        flag++;

        // Step 1: Split the input data into an array
        if (SEND_TO_DATABASE) {
            const shakeRepo = new Repository('shake')
            shakeRepo.create(jsonData);
            flag = 0;
        } else if (SAVE_IN_BUFFER && flag == 100) {

            fs.writeFileSync(pathToBuffer, JSON.stringify(bufferJson, null, 4), { flag: 'a+' });
            console.log("Data writed to buffer.json. ");
            bufferJson = [];
            console.log(sensing_time);
            flag = 0;
        } else if (SEND_TO_SERVER && flag == 100) { // 100
            sendDataToServer(postJsonURL, bufferJson);
            bufferJson = [];
            console.log(sensing_time);
            flag = 0;
        }


        index = 0;
    } catch (error) {
        console.log(error);
        const date = new Date();
        // fs.writeFileSync(`./logs/error_${date}.txt`, error);
        fs.writeFileSync(`./logs/error.txt`, error);
    }

})



// Port should be closed when you're done with all operations
port.on('close', () => {
    console.log("Port closed");
});