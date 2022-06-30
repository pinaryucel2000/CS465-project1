const PIXEL_SIZE = 0.02;
const BUFFER_SIZE = 64000000;

const RADIUS = 0.05; // radius of the circle of the brush and eraser
const ANGLE_MAX = 6.4; // 360 degrees in radians (approximate)
const ANGLE_INTERVAL_ELLIPSE = 0.02;
const ANGLE_INTERVAL = 0.2;
const SQUARE_COUNT_BRUSH = Math.round(ANGLE_MAX / ANGLE_INTERVAL);
const VERTICE_COUNT_BRUSH = SQUARE_COUNT_BRUSH * 6;
const Z_INDEX_INTERVAL = 0.0001;

// maximum number of strokes saved for undo and redo
const STACK_MAX = 25;

var bufferV = new Array(BUFFER_SIZE);
var bufferC = new Array(BUFFER_SIZE);
var bufferL = new Array(BUFFER_SIZE);

// for copying
var bufferVCopy = new Array(BUFFER_SIZE);
var bufferCCopy = new Array(BUFFER_SIZE);
var bufferLCopy = new Array(BUFFER_SIZE);
var copyIndex; // index of the copying buffers
var copyIndexStart; // index before copying rectangle is drawn
var copyCenter;

var canvas;
var gl;
var index = VERTICE_COUNT_BRUSH;
var draw = false; // true if mause is being pressed down
var brushColor = vec4(1.0, 0.0, 0.0, 1.0);
var zIndex = 1;
var currentLayer = "A";
var layerOrder = ["A", "B", "C", "D"];
var layerDiff = [1.5, 1.0, 0.5, 0.0];

var undoStack = [];
var redoStack = [];
var undoStackIndex = -1;
var redoStackIndex = -1;

// options: brush, triangle, rectangle, ellipse,
// unfilledTriangle, unfilledRectangle, unfilledEllipse,
// eraser, copy, paste
var selection = "brush";

var anchorPoint;
var initialIndex; // index when the user clicks on the canvas after selecting shape

window.onload = function init() {
  function getMouseLocation(event) {
    return vec2(
      (2 * event.clientX) / canvas.width - 1,
      (2 * (canvas.height - event.clientY)) / canvas.height - 1
    );
  }

  function brush(event) {
    // central point of the circle that represents the brush
    var centralPoint = getMouseLocation(event);
    var z = getZ();

    for (var i = -1; i < 1; i = i + PIXEL_SIZE) {
      for (var j = -1; j < 1; j = j + PIXEL_SIZE) {
        if (distance(centralPoint[0], centralPoint[1], i, j) <= RADIUS) {
          // leftBottomCorner,
          // leftTopCorner,
          // rightTopCorner,
          // rightBottomCorner,

          index = pushRectangle(
            vec3(i, j, z),
            vec3(i, j + PIXEL_SIZE, z),
            vec3(i + PIXEL_SIZE, j + PIXEL_SIZE, z),
            vec3(i + PIXEL_SIZE, j, z),
            index,
            brushColor
          );
        }
      }
    }
  }

  // pushes an unfilled triangle whose center point and max distance from center point to a vertex is given
  function pushTriangle(centerPoint, distance, index, color) {
    var vertices = [];

    vertices.push(
      vec3(centerPoint[0], centerPoint[1] + distance, centerPoint[2])
    );
    vertices.push(
      vec3(
        centerPoint[0] - Math.cos(0.523) * distance,
        centerPoint[1] - Math.sin(0.523) * distance,
        centerPoint[2]
      )
    );
    vertices.push(
      vec3(
        centerPoint[0] + Math.cos(0.523) * distance,
        centerPoint[1] - Math.sin(0.523) * distance,
        centerPoint[2]
      )
    );

    for (var i = 0; i < 3; i++) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 12 * index, flatten(vertices[i]));
      bufferV[index] = flatten(vertices[i]);
      gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 16 * index, flatten(color));
      bufferC[index] = flatten(color);

      // Layer
      gl.bindBuffer(gl.ARRAY_BUFFER, lBuffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        4 * index,
        flatten([getCurrentLayerDifference()])
      );
      bufferL[index] = flatten([getCurrentLayerDifference()]);

      index++;
    }

    return index;
  }

  function pushUnfilledTriangle(centerPoint, distance, index, color) {
    var vertices = [];
    var z = centerPoint[2];

    vertices.push(vec2(centerPoint[0], centerPoint[1] + distance));
    vertices.push(
      vec2(
        centerPoint[0] - Math.cos(0.523) * distance,
        centerPoint[1] - Math.sin(0.523) * distance
      )
    );
    vertices.push(
      vec2(
        centerPoint[0] + Math.cos(0.523) * distance,
        centerPoint[1] - Math.sin(0.523) * distance
      )
    );

    leftBottomCorner,
      leftTopCorner,
      rightTopCorner,
      rightBottomCorner,
      index,
      color;

    index = pushRectangle(
      vec3(vertices[1][0] - 2 * PIXEL_SIZE, vertices[1][1], z),
      vec3(vertices[0][0], vertices[0][1] + 2 * PIXEL_SIZE, z),
      vec3(vertices[0][0], vertices[0][1], z),
      vec3(vertices[1][0], vertices[1][1], z),
      index,
      color
    );

    index = pushRectangle(
      vec3(vertices[2][0] + 2 * PIXEL_SIZE, vertices[2][1], z),
      vec3(vertices[0][0], vertices[0][1] + 2 * PIXEL_SIZE, z),
      vec3(vertices[0][0], vertices[0][1], z),
      vec3(vertices[2][0], vertices[2][1], z),
      index,
      color
    );

    index = pushRectangle(
      vec3(vertices[1][0], vertices[1][1], z),
      vec3(vertices[1][0], vertices[1][1] + Math.cos(0.523) * PIXEL_SIZE, z),
      vec3(vertices[2][0], vertices[2][1] + Math.cos(0.523) * PIXEL_SIZE, z),
      vec3(vertices[2][0], vertices[2][1], z),

      index,
      color
    );
    return index;
  }

  function pushRectangle(
    leftBottomCorner,
    leftTopCorner,
    rightTopCorner,
    rightBottomCorner,
    index,
    color,
    isTool
  ) {
    var vertices = [];
    vertices.push(leftBottomCorner);
    vertices.push(leftTopCorner);
    vertices.push(rightTopCorner);
    vertices.push(rightBottomCorner);

    var order = [0, 1, 2, 0, 2, 3];
    var layerDiff;
    if (isTool) {
      layerDiff = 0.0;
    } else {
      layerDiff = getCurrentLayerDifference();
    }

    for (var j = 0; j < 6; j++) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        12 * index,
        flatten(vertices[order[j]])
      );
      bufferV[index] = vec3(vertices[order[j]]);
      gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 16 * index, flatten(color));
      bufferC[index] = flatten(color);

      // Layer

      gl.bindBuffer(gl.ARRAY_BUFFER, lBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 4 * index, flatten([layerDiff]));
      bufferL[index] = flatten([layerDiff]);

      index++;
    }

    return index;
  }

  function pushUnfilledRectangle(
    leftBottomCorner,
    leftTopCorner,
    rightTopCorner,
    rightBottomCorner,
    index,
    color,
    isTool
  ) {
    var z = leftBottomCorner[2];

    var leftBottom = 0;
    var leftTop = 0;
    var rightTop = 0;

    if (anchorPoint[0] > currentPoint[0] && anchorPoint[1] > currentPoint[1]) {
      leftBottom = PIXEL_SIZE;
    }

    if (anchorPoint[0] > currentPoint[0] && anchorPoint[1] < currentPoint[1]) {
      leftTop = PIXEL_SIZE;
    }

    if (anchorPoint[0] < currentPoint[0] && anchorPoint[1] < currentPoint[1]) {
      rightTop = PIXEL_SIZE;
    }

    index = pushRectangle(
      vec3(leftBottomCorner[0] - PIXEL_SIZE, leftBottomCorner[1] + rightTop, z),
      vec3(
        leftBottomCorner[0] - PIXEL_SIZE,
        leftTopCorner[1] + PIXEL_SIZE - leftTop,
        z
      ),
      vec3(leftBottomCorner[0], leftTopCorner[1] + PIXEL_SIZE - leftTop, z),
      vec3(leftBottomCorner[0], leftBottomCorner[1] + rightTop, z),
      index,
      color,
      isTool
    );

    index = pushRectangle(
      vec3(leftBottomCorner[0], leftBottomCorner[1], z),
      vec3(leftBottomCorner[0], leftBottomCorner[1] + PIXEL_SIZE, z),
      vec3(rightBottomCorner[0], rightBottomCorner[1] + PIXEL_SIZE, z),
      vec3(rightBottomCorner[0], rightBottomCorner[1], z),
      index,
      color,
      isTool
    );

    index = pushRectangle(
      vec3(leftBottomCorner[0] - PIXEL_SIZE, leftTopCorner[1], z),
      vec3(leftBottomCorner[0] - PIXEL_SIZE, leftTopCorner[1] + PIXEL_SIZE, z),
      vec3(rightTopCorner[0], rightTopCorner[1] + PIXEL_SIZE, z),
      vec3(rightTopCorner[0], rightTopCorner[1], z),
      index,
      color,
      isTool
    );

    index = pushRectangle(
      vec3(rightBottomCorner[0] - PIXEL_SIZE, leftBottomCorner[1] + leftTop, z),
      vec3(rightTopCorner[0] - PIXEL_SIZE, rightTopCorner[1] + leftBottom, z),
      vec3(rightTopCorner[0], rightTopCorner[1] + leftBottom, z),
      vec3(rightBottomCorner[0], rightBottomCorner[1] + leftTop, z),
      index,
      color,
      isTool
    );

    return index;
  }

  function pushEllipse(centralPoint, a, b, index, color) {
    var z = centralPoint[2];

    for (var i = -1; i < 1; i = i + PIXEL_SIZE) {
      for (var j = -1; j < 1; j = j + PIXEL_SIZE) {
        if (
          ((i - centralPoint[0]) * (i - centralPoint[0])) / (a * a) +
            ((j - centralPoint[1]) * (j - centralPoint[1])) / (b * b) <=
          1
        ) {
          // leftBottomCorner,
          // leftTopCorner,
          // rightTopCorner,
          // rightBottomCorner,

          index = pushRectangle(
            vec3(i, j, z),
            vec3(i, j + PIXEL_SIZE, z),
            vec3(i + PIXEL_SIZE, j + PIXEL_SIZE, z),
            vec3(i + PIXEL_SIZE, j, z),
            index,
            brushColor
          );
        }
      }
    }

    return index;
  }

  function pushUnfilledEllipse(centralPoint, a, b, index, color) {
    var angle = 0;
    var z = centralPoint[2];

    for (; angle < ANGLE_MAX; angle += ANGLE_INTERVAL_ELLIPSE) {
      leftBottomCorner = vec3(
        a * Math.cos(angle) + centralPoint[0],
        b * Math.sin(angle) + centralPoint[1],
        z
      );

      leftTopCorner = vec3(
        leftBottomCorner[0],
        leftBottomCorner[1] + PIXEL_SIZE,
        z
      );
      rightTopCorner = vec3(leftTopCorner[0] + PIXEL_SIZE, leftTopCorner[1], z);
      rightBottomCorner = vec3(
        leftBottomCorner[0] + PIXEL_SIZE,
        leftBottomCorner[1],
        z
      );

      index = pushRectangle(
        leftBottomCorner,
        leftTopCorner,
        rightTopCorner,
        rightBottomCorner,
        index,
        color
      );
    }

    return index;
  }

  function pushBrush(event) {
    var brushVerticeIndex = 0;

    // central point of the circle that represents the brush
    var centralPoint = getMouseLocation(event);

    var angle = 0;

    for (var i = 0; i < SQUARE_COUNT_BRUSH; i++) {
      leftBottomCorner = vec3(
        RADIUS * Math.cos(angle) + centralPoint[0],
        RADIUS * Math.sin(angle) + centralPoint[1],
        -1.0
      );

      leftTopCorner = vec3(
        leftBottomCorner[0],
        leftBottomCorner[1] + PIXEL_SIZE,
        -1.0
      );
      rightTopCorner = vec3(
        leftTopCorner[0] + PIXEL_SIZE,
        leftTopCorner[1],
        -1.0
      );
      rightBottomCorner = vec3(
        leftBottomCorner[0] + PIXEL_SIZE,
        leftBottomCorner[1],
        -1.0
      );

      brushVerticeIndex = pushRectangle(
        leftBottomCorner,
        leftTopCorner,
        rightTopCorner,
        rightBottomCorner,
        brushVerticeIndex,
        colors[0],
        true
      );

      angle += ANGLE_INTERVAL;
    }
  }

  function removeBrush() {
    gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);

    for (var i = 0; i < VERTICE_COUNT_BRUSH; i++) {
      gl.bufferSubData(gl.ARRAY_BUFFER, 12 * i, flatten(vec3(0.0, 0.0, 1.0)));
      bufferV[i] = flatten(vec3(0.0, 0.0, 1.0));
    }
  }

  function erase(currentPoint) {
    var i = VERTICE_COUNT_BRUSH;
    var x1 = currentPoint[0];
    var y1 = currentPoint[1];
    var x2;
    var y2;

    while (i < index) {
      for (var j = 0; j < 3; j++) {
        x2 = bufferV[i + j][0];
        y2 = bufferV[i + j][1];
        layer = bufferL[i + j];

        if (
          distance(x1, y1, x2, y2) <= RADIUS &&
          layer == getCurrentLayerDifference()
        ) {
          for (var k = 0; k < 3; k++) {
            bufferV[i + k] = bufferV[index - 3 + k];
            bufferC[i + k] = bufferC[index - 3 + k];
            bufferL[i + k] = bufferL[index - 3 + k];

            gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
            gl.bufferSubData(
              gl.ARRAY_BUFFER,
              12 * (i + k),
              flatten(bufferV[index - 3 + k])
            );

            gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
            gl.bufferSubData(
              gl.ARRAY_BUFFER,
              16 * (i + k),
              flatten(bufferC[index - 3 + k])
            );

            gl.bindBuffer(gl.ARRAY_BUFFER, lBuffer);
            gl.bufferSubData(
              gl.ARRAY_BUFFER,
              4 * (i + k),
              flatten(bufferL[index - 3 + k])
            );
          }
          index = index - 3;
          break;
        }
      }

      i = i + 3;
    }
  }

  function copy(event) {
    var mouseLocation = getMouseLocation(event);
    var center = vec2(
      (anchorPoint[0] + mouseLocation[0]) / 2,
      (anchorPoint[1] + mouseLocation[1]) / 2
    );
    copyCenter = center;
    var width = Math.abs(anchorPoint[0] - mouseLocation[0]);
    var height = Math.abs(anchorPoint[1] - mouseLocation[1]);
    copyIndex = 0;

    for (var i = VERTICE_COUNT_BRUSH; i < index - 3; i = i + 3) {
      if (
        Math.abs(bufferV[i][0] - center[0]) <= width / 2 &&
        Math.abs(bufferV[i][1] - center[1]) <= height / 2 &&
        bufferL[i] == getCurrentLayerDifference()
      ) {
        for (var j = 0; j < 3; j++) {
          bufferVCopy[copyIndex] = bufferV[i + j];
          bufferCCopy[copyIndex] = bufferC[i + j];
          bufferLCopy[copyIndex] = bufferL[i + j];
          copyIndex++;
        }
      }
    }
  }

  function paste(event) {
    var mouseLocation = getMouseLocation(event);
    var x;
    var y;

    for (var i = 0; i < copyIndex; i++) {
      x = bufferVCopy[i][0] - copyCenter[0] + mouseLocation[0];
      y = bufferVCopy[i][1] - copyCenter[1] + mouseLocation[1];

      if (x <= 1 && x >= -1 && y <= 1 && y >= -1) {
        gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          12 * index,
          flatten(vec3(x, y, bufferVCopy[i][2]))
        );

        bufferV[index] = vec3(x, y, bufferVCopy[i][2]);

        gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 16 * index, flatten(bufferCCopy[i]));
        bufferC[index] = flatten(bufferCCopy[i]);

        // Layer
        gl.bindBuffer(gl.ARRAY_BUFFER, lBuffer);
        gl.bufferSubData(gl.ARRAY_BUFFER, 4 * index, flatten([bufferLCopy[i]]));
        bufferL[index] = flatten([bufferLCopy[i]]);

        index++;
      }
    }
  }

  canvas = document.getElementById("gl-canvas");

  gl = WebGLUtils.setupWebGL(canvas);
  if (!gl) {
    alert("WebGL isn't available");
  }

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(1.0, 1.0, 1.0, 1.0);

  canvas.addEventListener("mousedown", function (event) {
    draw = true;
    undoStackIndex = pushStack(index, undoStack, undoStackIndex);

    if (draw && selection == "brush") {
      brush(event);
    } else if (selection == "eraser") {
      erase(getMouseLocation(event));
    } else if (selection == "copy") {
      copyIndexStart = index;
      anchorPoint = getMouseLocation(event);
    } else {
      initialIndex = index;
      anchorPoint = getMouseLocation(event);
    }
  });

  canvas.addEventListener("mouseup", function (event) {
    draw = false;
    removeBrush();
    if (selection == "copy") {
      index = copyIndexStart;
      copy(event);
      selection = "brush";
      return;
    }

    if (selection == "paste") {
      paste(event);
      selection = "brush";
      return;
    }

    if (selection != "eraser" && selection != "brush") {
      zIndex = zIndex - Z_INDEX_INTERVAL;
    }

    if (selection != "eraser") {
      selection = "brush";
    }
  });

  canvas.addEventListener("mousemove", function (event) {
    currentPoint = getMouseLocation(event);

    if (draw && selection == "brush") {
      brush(event);
    } else if (draw && selection == "eraser") {
      erase(currentPoint);
    }
    if (selection == "brush" || selection == "eraser") {
      pushBrush(event);
    } else if (draw) {
      removeBrush();

      if (selection == "copy") {
        index = pushUnfilledRectangle(
          vec3(anchorPoint[0], currentPoint[1], -1.0),
          vec3(anchorPoint[0], anchorPoint[1], -1.0),
          vec3(currentPoint[0], anchorPoint[1], -1.0),
          vec3(currentPoint[0], currentPoint[1], -1.0),
          copyIndexStart,
          colors[0],
          true
        );
      } else if (selection == "triangle") {
        index = pushTriangle(
          vec3(anchorPoint[0], anchorPoint[1], zIndex - Z_INDEX_INTERVAL),
          distance(
            currentPoint[0],
            currentPoint[1],
            anchorPoint[0],
            anchorPoint[1]
          ),
          initialIndex,
          brushColor
        );
      } else if (selection == "rectangle") {
        index = pushRectangle(
          vec3(anchorPoint[0], currentPoint[1], zIndex - Z_INDEX_INTERVAL),
          vec3(anchorPoint[0], anchorPoint[1], zIndex - Z_INDEX_INTERVAL),
          vec3(currentPoint[0], anchorPoint[1], zIndex - Z_INDEX_INTERVAL),
          vec3(currentPoint[0], currentPoint[1], zIndex - Z_INDEX_INTERVAL),
          initialIndex,
          brushColor
        );
      } else if (selection == "ellipse") {
        index = pushEllipse(
          vec3(
            (currentPoint[0] + anchorPoint[0]) / 2,
            (currentPoint[1] + anchorPoint[1]) / 2,
            zIndex - Z_INDEX_INTERVAL
          ),
          Math.abs((currentPoint[0] - anchorPoint[0]) / 2),
          Math.abs((currentPoint[1] - anchorPoint[1]) / 2),
          initialIndex,
          brushColor
        );
      } else if (selection == "unfilledTriangle") {
        index = pushUnfilledTriangle(
          vec3(anchorPoint[0], anchorPoint[1], zIndex - Z_INDEX_INTERVAL),
          distance(
            currentPoint[0],
            currentPoint[1],
            anchorPoint[0],
            anchorPoint[1]
          ),
          initialIndex,
          brushColor
        );
      } else if (selection == "unfilledRectangle") {
        index = pushUnfilledRectangle(
          vec3(anchorPoint[0], currentPoint[1], zIndex - Z_INDEX_INTERVAL),
          vec3(anchorPoint[0], anchorPoint[1], zIndex - Z_INDEX_INTERVAL),
          vec3(currentPoint[0], anchorPoint[1], zIndex - Z_INDEX_INTERVAL),
          vec3(currentPoint[0], currentPoint[1], zIndex - Z_INDEX_INTERVAL),
          initialIndex,
          brushColor,
          false
        );
      } else if (selection == "unfilledEllipse") {
        index = pushUnfilledEllipse(
          vec3(
            (currentPoint[0] + anchorPoint[0]) / 2,
            (currentPoint[1] + anchorPoint[1]) / 2,
            zIndex - Z_INDEX_INTERVAL
          ),
          Math.abs((currentPoint[0] - anchorPoint[0]) / 2),
          Math.abs((currentPoint[1] - anchorPoint[1]) / 2),
          initialIndex,
          brushColor
        );
      }
    }
  });

  document.getElementById("save").onclick = function () {
    // DOWNLOAD FUNCTION IS TAKEN FROM WEB
    function download(filename, text) {
      var element = document.createElement("a");
      element.setAttribute(
        "href",
        "data:text/plain;charset=utf-8," + encodeURIComponent(text)
      );
      element.setAttribute("download", filename);

      element.style.display = "none";
      document.body.appendChild(element);

      element.click();

      document.body.removeChild(element);
    }
    // DOWNLOAD FUNCTION IS TAKEN FROM WEB

    var data = index + " ";
    data = data + zIndex + " ";
    data = data + currentLayer + " ";
    data = data + layerOrder[0] + " ";
    data = data + layerOrder[1] + " ";
    data = data + layerOrder[2] + " ";
    data = data + layerOrder[3] + " ";
    var i = VERTICE_COUNT_BRUSH;

    while (i != index) {
      data = data + bufferV[i][0];
      data = data + "?";
      data = data + bufferV[i][1];
      data = data + "?";
      data = data + bufferV[i][2];
      data = data + " ";
      i++;
    }

    data = data + ":";
    i = VERTICE_COUNT_BRUSH;

    while (i != index) {
      data = data + bufferC[i][0];
      data = data + "?";
      data = data + bufferC[i][1];
      data = data + "?";
      data = data + bufferC[i][2];
      data = data + "?";
      data = data + bufferC[i][3];
      data = data + " ";
      i++;
    }

    data = data + ":";
    i = VERTICE_COUNT_BRUSH;

    while (i != index) {
      data = data + bufferL[i];
      data = data + " ";
      i++;
    }

    download("paint.txt", data);
  };

  $("#sortable").on("sortupdate", function (event, ui) {
    newLayerOrder = $("#sortable").sortable("toArray");
    var map = {};

    for (var i = 0; i < 4; i++) {
      for (var j = 0; j < 4; j++) {
        if (layerOrder[i] == newLayerOrder[j]) {
          map[layerDiff[i]] = layerDiff[j];
        }
      }
    }

    layerOrder = newLayerOrder;

    for (var i = VERTICE_COUNT_BRUSH; i < index; i++) {
      // Layer
      if (bufferL[i]) gl.bindBuffer(gl.ARRAY_BUFFER, lBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 4 * i, flatten([map[bufferL[i]]]));
      bufferL[i] = flatten([map[bufferL[i]]]);
    }
  });

  document.getElementById("file").addEventListener("change", getFile);

  // CODE TAKEN FROM WEB TO READ THE CONTENTS OF THE UPLOADED FILE
  function getFile(event) {
    const input = event.target;
    if ("files" in input && input.files.length > 0) {
      placeFileContent(input.files[0]);
    }
  }

  function readFileContent(file) {
    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = (event) => resolve(event.target.result);
      reader.onerror = (error) => reject(error);
      reader.readAsText(file);
    });
  }
  // CODE TAKEN FROM WEB TO READ THE CONTENTS OF THE UPLOADED FILE

  function placeFileContent(file) {
    readFileContent(file)
      .then((content) => {
        var length = content.length;
        var fi = 0; // file index
        var bi = VERTICE_COUNT_BRUSH; // buffer index
        var tmp1 = "";
        var tmp2 = "";
        var tmp3 = "";
        var tmp4 = "";

        while (content[fi] != " ") {
          tmp1 = tmp1 + content[fi];
          fi++;
        }

        fi++;
        index = parseInt(tmp1);
        tmp1 = "";

        while (content[fi] != " ") {
          tmp1 = tmp1 + content[fi];
          fi++;
        }

        fi++;
        zIndex = parseFloat(tmp1);
        tmp1 = "";

        while (content[fi] != " ") {
          tmp1 = tmp1 + content[fi];
          fi++;
        }

        fi++;
        document.getElementById("radio" + tmp1).checked = true;
        currentLayer = tmp1;
        tmp1 = "";

        for (var i = 0; i < 4; i++) {
          while (content[fi] != " ") {
            tmp1 = tmp1 + content[fi];
            fi++;
          }

          fi++;
          layerOrder[i] = tmp1;
          tmp1 = "";
        }

        var items = $("#sortable").find("li");
        var order = [];

        for (var i = 0; i < 4; i++) {
          if (layerOrder[i] == "A") {
            order.push(0);
          } else if (layerOrder[i] == "B") {
            order.push(1);
          } else if (layerOrder[i] == "C") {
            order.push(2);
          } else if (layerOrder[i] == "D") {
            order.push(3);
          }
        }

        var orderedItems = $.map(order, function (value) {
          return items.get(value);
        });

        $("#sortable").empty().html(orderedItems);

        gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);

        while (content[fi] != ":") {
          while (content[fi] != "?") {
            tmp1 = tmp1 + content[fi];
            fi++;
          }

          fi++;

          while (content[fi] != "?") {
            tmp2 = tmp2 + content[fi];
            fi++;
          }

          fi++;

          while (content[fi] != " ") {
            tmp3 = tmp3 + content[fi];
            fi++;
          }

          fi++;

          bufferV[bi] = vec3(
            parseFloat(tmp1),
            parseFloat(tmp2),
            parseFloat(tmp3)
          );
          gl.bufferSubData(gl.ARRAY_BUFFER, 12 * bi, flatten([bufferV[bi]]));
          bi++;
          tmp1 = "";
          tmp2 = "";
          tmp3 = "";
        }

        fi++;
        bi = VERTICE_COUNT_BRUSH;
        gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);

        while (content[fi] != ":") {
          while (content[fi] != "?") {
            tmp1 = tmp1 + content[fi];
            fi++;
          }

          fi++;

          while (content[fi] != "?") {
            tmp2 = tmp2 + content[fi];
            fi++;
          }

          fi++;

          while (content[fi] != "?") {
            tmp3 = tmp3 + content[fi];
            fi++;
          }

          fi++;

          while (content[fi] != " ") {
            tmp4 = tmp4 + content[fi];
            fi++;
          }

          fi++;

          bufferC[bi] = vec4(
            parseFloat(tmp1),
            parseFloat(tmp2),
            parseFloat(tmp3),
            parseFloat(tmp4)
          );

          gl.bufferSubData(gl.ARRAY_BUFFER, 16 * bi, flatten([bufferC[bi]]));
          bi++;
          tmp1 = "";
          tmp2 = "";
          tmp3 = "";
          tmp4 = "";
        }

        fi++;
        bi = VERTICE_COUNT_BRUSH;
        gl.bindBuffer(gl.ARRAY_BUFFER, lBuffer);

        while (fi < length) {
          while (content[fi] != " ") {
            tmp1 = tmp1 + content[fi];
            fi++;
          }

          fi++;
          bufferL[bi] = parseFloat(tmp1);
          gl.bufferSubData(gl.ARRAY_BUFFER, 4 * bi, flatten([bufferL[bi]]));
          bi++;
          tmp1 = "";
        }
      })
      .catch((error) => console.log(error));
  }

  //  Load shaders and initialize attribute buffers
  var program = initShaders(gl, "vertex-shader", "fragment-shader");
  gl.useProgram(program);

  // Enable hidden-surface removal
  gl.enable(gl.DEPTH_TEST);

  var vBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, BUFFER_SIZE, gl.STATIC_DRAW);

  var vPosition = gl.getAttribLocation(program, "vPosition");
  gl.vertexAttribPointer(vPosition, 3, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vPosition);

  var cBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, BUFFER_SIZE, gl.STATIC_DRAW);

  var vColor = gl.getAttribLocation(program, "vColor");
  gl.vertexAttribPointer(vColor, 4, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vColor);

  // For layers
  var lBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, lBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, BUFFER_SIZE, gl.STATIC_DRAW);

  var vLayer = gl.getAttribLocation(program, "vLayer");
  gl.vertexAttribPointer(vLayer, 1, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(vLayer);

  render();
};

function render() {
  gl.clear(gl.COLOR_BUFFER_BIT, gl.ARRAY_BUFFER);

  for (var i = VERTICE_COUNT_BRUSH; i < index; i = i + 3) {
    gl.drawArrays(gl.TRIANGLES, i, 3);
  }

  // brush circle
  if (selection == "brush" || selection == "eraser") {
    for (var i = 0; i < VERTICE_COUNT_BRUSH; i = i + 3) {
      gl.drawArrays(gl.TRIANGLES, i, 3);
    }
  }

  window.requestAnimFrame(render);
}

function undo() {
  if (undoStackIndex == -1) {
    return;
  }

  redoStackIndex = pushStack(index, redoStack, redoStackIndex);
  index = undoStack[undoStackIndex];

  undoStack.pop();
  undoStackIndex--;
}

function redo() {
  if (redoStackIndex == -1) {
    return;
  }

  undoStackIndex = pushStack(index, undoStack, undoStackIndex);

  index = redoStack[redoStackIndex];
  redoStack.pop();
  redoStackIndex--;
}

// pushes a new value to a stack, shifts elements if the stack is full so that the first one is popped
function pushStack(value, stack, stackIndex) {
  if (stack.length != STACK_MAX) {
    stack.push(value);
    stackIndex++;
  } else {
    // shift elements
    for (var i = 0; i < STACK_MAX; i++) {
      stack[i] = stack[i + 1];
    }

    stack[stackIndex] = value;
  }

  return stackIndex;
}

function setBrushColor(color) {
  brushColor = color;
}

function roundUp(value, precision) {
  var pow = Math.pow(10, precision);
  return (
    (Math.ceil(pow * value) + Math.ceil(pow * value - Math.ceil(pow * value))) /
    pow
  );
}

function distance(x1, y1, x2, y2) {
  return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
}

function drawShape(s) {
  selection = s;
}

function eraserModeOn() {
  selection = "eraser";
}

function brushModeOn() {
  selection = "brush";
}

var colors = [
  vec4(0.2, 0.2, 0.2, 1.0), // brush color
  vec4(1.0, 0.0, 0.0, 1.0), // red
  vec4(1.0, 1.0, 0.0, 1.0), // yellow
  vec4(0.0, 1.0, 0.0, 1.0), // green
  vec4(0.0, 0.0, 1.0, 1.0), // blue
  vec4(1.0, 0.0, 1.0, 1.0), // magenta
  vec4(0.0, 1.0, 1.0, 1.0), // cyan
];

function getZ() {
  zIndex = zIndex - Z_INDEX_INTERVAL;
  return zIndex;
}

function setCurrentLayer(layer) {
  currentLayer = layer;
}

function getCurrentLayerDifference() {
  if (layerOrder[0] == currentLayer) {
    return layerDiff[0];
  } else if (layerOrder[1] == currentLayer) {
    return layerDiff[1];
  } else if (layerOrder[2] == currentLayer) {
    return layerDiff[2];
  } else {
    return layerDiff[3];
  }
}

function copyOn() {
  selection = "copy";
}

function pasteOn() {
  selection = "paste";
}
