let recognizer;

let labels = $('#options>option').map(function () {
    return $(this).val()
})
async function app() {
    recognizer = speechCommands.create('BROWSER_FFT');
    await recognizer.ensureModelLoaded();
    buildModel();
}

app();

// One frame is ~23ms of audio.
const NUM_FRAMES = 3;
// This will be our data.
let examples = [];

function collect() {
    if (recognizer.isListening()) {
        return recognizer.stopListening();
    }
    let label = parseInt($('#options option:selected').val()) - 1;
    recognizer.listen(async ({
        spectrogram: {
            frameSize,
            data
        }
    }) => {
        let vals = normalize(data.subarray(-frameSize * NUM_FRAMES));
        examples.push({
            vals,
            label
        });
        document.querySelector('#console').textContent =
            `${examples.length} examples collected`;
    }, {
        overlapFactor: 0.999,
        includeSpectrogram: true,
        invokeCallbackOnNoiseAndUnknown: true
    });
}

// "Normal" values given by spectrogram
function normalize(x) {
    const mean = -100;
    const std = 10;
    return x.map(x => (x - mean) / std);
}

// consider changing number of frames if interested in words, not in just sounds.
// 232 frequency buckets, is the amount needed to capture the human voice.
// is this sufficient for sounds made by other than humans?
const INPUT_SHAPE = [NUM_FRAMES, 232, 1];
let model;

async function train() {
    if(examples.length === 0){
        document.querySelector('#console').textContent = "You need to collect data before training.."
        return;
    }
    toggleButtons(false);
    const ys = tf.oneHot(examples.map(e => e.label), labels.length);
    const xsShape = [examples.length, ...INPUT_SHAPE];
    const xs = tf.tensor(flatten(examples.map(e => e.vals)), xsShape);
    console.log("ys:", ys);
    await model.fit(xs, ys, {
        batchSize: 16,
        epochs: 10,
        callbacks: {
            onEpochEnd: (epoch, logs) => {
                document.querySelector('#console').textContent =
                    `Accuracy: ${(logs.acc * 100).toFixed(1)}% Epoch: ${epoch + 1}`;
            }
        }
    });
    tf.dispose([xs, ys]);
    toggleButtons(true);
}

function buildModel() {
    model = tf.sequential();
    model.add(tf.layers.depthwiseConv2d({
        depthMultiplier: 8,
        kernelSize: [NUM_FRAMES, 3],
        activation: 'relu',
        inputShape: INPUT_SHAPE
    }));
    model.add(tf.layers.maxPooling2d({
        poolSize: [1, 2],
        strides: [2, 2]
    }));
    model.add(tf.layers.flatten());
    model.add(tf.layers.dense({
        units: labels.length,
        activation: 'softmax'
    }));
    const optimizer = tf.train.adam(0.01);
    model.compile({
        optimizer,
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
    });
}

function toggleButtons(enable) {
    document.querySelectorAll('button').forEach(b => b.disabled = !enable);
}

function flatten(tensors) {
    const size = tensors[0].length;
    const result = new Float32Array(tensors.length * size);
    tensors.forEach((arr, i) => result.set(arr, i * size));
    return result;
}

async function moveSlider(labelTensor) {
    const label = (await labelTensor.data())[0];
    document.getElementById('console').textContent = labels[label];
    if (label == 2) {
        return;
    }
    let delta = 0.1;
    const prevValue = +document.getElementById('output').value;
    document.getElementById('output').value =
        prevValue + (label === 0 ? -delta : delta);
}

function listen() {
    if (recognizer.isListening()) {
        recognizer.stopListening();
        toggleButtons(true);
        document.getElementById('listen').textContent = 'Listen';
        return;
    }
    toggleButtons(false);
    document.getElementById('listen').textContent = 'Stop';
    document.getElementById('listen').disabled = false;

    recognizer.listen(async ({
        spectrogram: {
            frameSize,
            data
        }
    }) => {
        const vals = normalize(data.subarray(-frameSize * NUM_FRAMES));
        const input = tf.tensor(vals, [1, ...INPUT_SHAPE]);
        const probs = model.predict(input);
        const predLabel = probs.argMax(1);
        await moveSlider(predLabel);
        tf.dispose([input, probs, predLabel]);
    }, {
        overlapFactor: 0.999,
        includeSpectrogram: true,
        invokeCallbackOnNoiseAndUnknown: true,
        probabilityThreshold: 0.9
    });
}