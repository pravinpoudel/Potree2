

import * as dat from "./libs/dat.gui/dat.gui.module.js";
import { Vector3 } from "./src/math/math.js";
import { render as renderMesh } from "./src/modules/mesh/renderMesh.js";
import * as ProgressiveLoader from "./src/modules/progressive_loader/ProgressiveLoader.js";
import { OrbitControls } from "./src/navigation/OrbitControls.js";
import { Potree } from "./src/Potree.js";
import { render as renderPointsArbitraryAttributes } from "./src/potree/arbitrary_attributes/renderPoints_arbitrary_attributes.js";
import { renderAtomic } from "./src/potree/renderAtomic.js";
import { renderDilate } from "./src/potree/renderDilate.js";
import { render as renderPoints } from "./src/potree/renderPoints.js";
import { render as renderQuads } from "./src/potree/renderQuads.js";
import { renderAtomicDilate } from "./src/potree/render_compute_dilate/render_compute_dilate.js";
import { renderComputeLoop } from "./src/potree/render_compute_loop/render_compute_loop.js";
import { renderComputeNoDepth } from "./src/potree/render_compute_no_depth/render_compute_no_depth.js";
import { render as renderComputePacked } from "./src/potree/render_compute_packed/render_compute_packed.js";
import { render as renderComputeXRay } from "./src/potree/render_compute_xray/render_compute_xray.js";
import { render as renderProgressive } from "./src/potree/render_progressive/render_progressive.js";
import { drawTexture } from "./src/prototyping/textures.js";
import { Renderer } from "./src/renderer/Renderer.js";
import * as Timer from "./src/renderer/Timer.js";
import { Camera } from "./src/scene/Camera.js";
import { PointLight } from "./src/scene/PointLight.js";
import { Scene } from "./src/scene/Scene.js";

let frame = 0;
let lastFpsCount = 0;
let framesSinceLastCount = 0;
let fps = 0;

let renderer = null;
let camera = null;
let controls = null;
let progress = null;

let scene = new Scene();

let boxes = [];

let gui = null;
let guiContent = {

	// INFOS
	"#points": "0",
	"#nodes": "0",
	"fps": "0",
	"duration(update)": "0",
	// "timings": "",
	"camera": "",


	// INPUT
	"show bounding box": false,
	"mode": "points",
	// "mode": "points/quads",
	//"mode": "points/atomic",
	// "mode": "compute/dilate",
	// "mode": "compute/xray",
	// "mode": "compute/packed",
	// "mode": "compute/loop",
	// "mode": "compute/no_depth",
	// "mode": "progressive",
	"attribute": "rgba",
	"point budget (M)": 2,
	"point size": 3,
	"update": true,

	// COLOR ADJUSTMENT
	"scalar min": 0,
	"scalar max": 2 ** 16,
	"gamma": 1,
	"brightness": 0,
	"contrast": 0,
};
window.guiContent = guiContent;
let guiAttributes = null;
let guiScalarMin = null;
let guiScalarMax = null;


function initGUI(){

	gui = new dat.GUI();
	window.gui = gui;
	
	{
		let stats = gui.addFolder("stats");
		stats.open();
		stats.add(guiContent, "#points").listen();
		stats.add(guiContent, "#nodes").listen();
		stats.add(guiContent, "fps").listen();
		stats.add(guiContent, "duration(update)").listen();
		stats.add(guiContent, "camera").listen();
	}

	{
		let input = gui.addFolder("input");
		input.open();

		input.add(guiContent, "mode", [
			"points", 
			"points/quads", 
			"points/dilate", 
			"points/atomic",
			"compute/dilate",
			"compute/loop",
			"compute/no_depth",
			"compute/packed",
			"compute/xray",
			"progressive",
			]);
		input.add(guiContent, "show bounding box");
		input.add(guiContent, "update");
		guiAttributes = input.add(guiContent, "attribute", ["rgba"]).listen();
		window.guiAttributes = guiAttributes;

		// slider
		input.add(guiContent, 'point budget (M)', 0.01, 5);
		input.add(guiContent, 'point size', 1, 5);
	}

	{
		let input = gui.addFolder("Color Adjustments");
		input.open();

		guiScalarMin = input.add(guiContent, 'scalar min', 0, 2 ** 16).listen();
		guiScalarMax = input.add(guiContent, 'scalar max', 0, 2 ** 16).listen();
		input.add(guiContent, 'gamma', 0, 2).listen();
		input.add(guiContent, 'brightness', -1, 1).listen();
		input.add(guiContent, 'contrast', -1, 1).listen();
	}

}

function update(){
	let now = performance.now();

	if((now - lastFpsCount) >= 1000.0){

		fps = framesSinceLastCount;

		lastFpsCount = now;
		framesSinceLastCount = 0;
		guiContent["fps"] = Math.floor(fps).toLocaleString();
	}
	

	frame++;
	framesSinceLastCount++;

	controls.update();
	camera.world.copy(controls.world);

	camera.updateView();
	guiContent["camera"] = camera.getWorldPosition().toString(1);

	let size = renderer.getSize();
	camera.aspect = size.width / size.height;
	camera.updateProj();

	let pointcloud = window.pointcloud;
	if(pointcloud){
		pointcloud.showBoundingBox = guiContent["show bounding box"];
		pointcloud.pointBudget = guiContent["point budget (M)"] * 1_000_000;
		pointcloud.pointSize = guiContent["point size"];

		if(guiContent["update"]){
			let duration = pointcloud.updateVisibility(camera);

			if((frame % 60) === 0){
				guiContent["duration(update)"] = `${(duration / 1000).toFixed(1)}ms`;
			}
		}

		let numPoints = pointcloud.visibleNodes.map(n => n.geometry.numElements).reduce( (a, i) => a + i, 0);
		let numNodes = pointcloud.visibleNodes.length;

		guiContent["#points"] = numPoints.toLocaleString();
		guiContent["#nodes"] = numNodes.toLocaleString();
	}
}

function render(){

	let renderables = new Map();

	let stack = [scene.root];
	while(stack.length > 0){
		let node = stack.pop();

		let nodeType = node.constructor.name;
		if(!renderables.has(nodeType)){
			renderables.set(nodeType, []);
		}
		renderables.get(nodeType).push(node);

		for(let child of node.children){
			stack.push(child);
		}
	}

	let pointcloud = window.pointcloud;
	let target = null;

	Timer.frameStart(renderer);

	let shouldDrawTarget = false;
	if(pointcloud && guiContent["mode"] === "points/dilate"){
		target = renderDilate(renderer, pointcloud, camera);
		target = target.colorAttachments[0].texture;

		shouldDrawTarget = true;
	}else if(pointcloud && guiContent["mode"] === "points/atomic"){
		target = renderAtomic(renderer, pointcloud, camera);
		shouldDrawTarget = true;
	}else if(pointcloud && guiContent["mode"] === "compute/dilate"){
		target = renderAtomicDilate(renderer, pointcloud, camera);
		shouldDrawTarget = true;
	}else if(pointcloud && guiContent["mode"] === "compute/loop"){
		target = renderComputeLoop(renderer, pointcloud, camera);
		shouldDrawTarget = true;
	}else if(pointcloud && guiContent["mode"] === "compute/packed"){
		target = renderComputePacked(renderer, pointcloud, camera);
		shouldDrawTarget = true;
	}else if(pointcloud && guiContent["mode"] === "compute/no_depth"){
		target = renderComputeNoDepth(renderer, pointcloud, camera);
		shouldDrawTarget = true;
	}else if(pointcloud && guiContent["mode"] === "compute/xray"){
		target = renderComputeXRay(renderer, pointcloud, camera);
		shouldDrawTarget = true;
	}else if(pointcloud && guiContent["mode"] === "progressive"){
		target = renderProgressive(renderer, pointcloud, camera);
		shouldDrawTarget = true;
	}

	Timer.timestampSep(renderer, "000");


	let pass = renderer.start();

	Timer.timestamp(pass.passEncoder, "010");

	// draw point cloud
	if(pointcloud && guiContent["mode"] === "points"){
		renderPointsArbitraryAttributes(renderer, pass, pointcloud, camera);
		// renderPoints(renderer, pass, pointcloud, camera);
	}else if(pointcloud && guiContent["mode"] === "points/quads"){

		if(pointcloud.pointSize === 1){
			renderPoints(renderer, pass, pointcloud, camera);
		}else{
			renderQuads(renderer, pass, pointcloud, camera);
		}
	}else if(shouldDrawTarget){
		drawTexture(renderer, pass, target, 0, 0, 1, 1);
	}

	Timer.timestamp(pass.passEncoder, "020");
	

	// { // draw xyz axes
	// 	renderer.drawLine(new Vector3(0, 0, 0), new Vector3(2, 0, 0), new Vector3(255, 0, 0));
	// 	renderer.drawLine(new Vector3(0, 0, 0), new Vector3(0, 2, 0), new Vector3(0, 255, 0));
	// 	renderer.drawLine(new Vector3(0, 0, 0), new Vector3(0, 0, 2), new Vector3(0, 0, 255));
	// }

	// draw boxes
	if(guiContent["show bounding box"]){ 
		for(let box of boxes){
			let position = box.center();
			let size = box.size();
			let color = new Vector3(255, 255, 0);

			renderer.drawBoundingBox(position, size, color);
		}
	}

	{
		let meshes = renderables.get("Mesh") ?? [];

		for(let mesh of meshes){
			renderMesh(renderer, pass, mesh, camera, renderables);
		}

	}

	renderer.renderDrawCommands(pass, camera);
	renderer.finish(pass);

	Timer.frameEnd(renderer);

}

function loop(){
	update();
	render();

	requestAnimationFrame(loop);
}

async function run(){

	initGUI();

	renderer = new Renderer();
	window.renderer = renderer;

	await renderer.init();

	camera = new Camera();
	controls = new OrbitControls(renderer.canvas);

	window.camera = camera;
	window.controls = controls;

	camera.fov = 60;

	{
		let element = document.getElementById("canvas");
		ProgressiveLoader.install(element, (e) => {
			//console.log(e.boxes);
			boxes = e.boxes;

			progress = e.progress;
			window.progress = progress;

			console.log(progress);

			let pivot = progress.boundingBox.center();
			pivot.z = 0.8 * progress.boundingBox.min.z + 0.2 * progress.boundingBox.max.z;
			controls.pivot.copy(pivot);
			controls.radius = progress.boundingBox.size().length() * 0.7;

			window.pointcloud = progress.octree;
		});
	}

	controls.set({
		yaw: -0.2,
		pitch: 0.8,
		radius: 20,
	});

	// Potree.load("./resources/pointclouds/lion/metadata.json").then(pointcloud => {

	// 	controls.set({
	// 		pivot: [0.46849801014552056, -0.5089652605462774, 4.694897729016537],
	// 		pitch: 0.3601621061369527,
	// 		yaw: -0.610317525598302,
	// 		radius: 6.3,
	// 	});

	// 	window.pointcloud = pointcloud;
	// });

	// Potree.load("./resources/pointclouds/heidentor/metadata.json").then(pointcloud => {
	// 	controls.radius = 20;
	// 	controls.yaw = 2.7 * Math.PI / 4;
	// 	controls.pitch = Math.PI / 6;
	
	// 	pointcloud.updateVisibility(camera);
	// 	window.pointcloud = pointcloud;
	// });

	

	Potree.load("./resources/pointclouds/eclepens/metadata.json").then(pointcloud => {

		controls.set({
			radius: 700,
			yaw: -0.2,
			pitch: 0.8,
		});
		
		camera.near = 1;
		camera.far = 10_000;
		camera.updateProj();
	
		window.pointcloud = pointcloud;
	});


	// Potree.load("./resources/pointclouds/CA13/metadata.json").then(pointcloud => {
	// // Potree.load("http://5.9.65.151/mschuetz/potree/resources/pointclouds/opentopography/CA13_2.0.2_brotli/metadata.json").then(pointcloud => {
	// 	camera.near = 0.5;
	// 	camera.far = 100_000;

	// 	controls.set({
	// 		radius: 2_400,
	// 		yaw: 0.034,
	// 		pitch: 0.629,
	// 		pivot: [694698.4629456067, 3916428.1845130883, -15.72393889322449],
	// 	});

	// 	let attributes = pointcloud.loader.attributes.attributes.map(b => b.name).filter(n => n !== "position");

	// 	guiAttributes = guiAttributes.options(attributes).setValue("rgba").onChange(() => {
	// 		let attributeName = guiContent.attribute;
	// 		let attribute = pointcloud.loader.attributes.attributes.find(a => a.name === attributeName);
	// 		let range = attribute.range;

	// 		let getRangeVal = (val) => {
	// 			if(typeof val === "number"){
	// 				return val;
	// 			}else{
	// 				return Math.max(...val);
	// 			}
	// 		};

	// 		let low = getRangeVal(range[0]);
	// 		let high = getRangeVal(range[1]);

	// 		if(attributeName === "rgba"){
	// 			low = 0;
	// 			high = high > 255 ? (2 ** 16 - 1) : 255;
	// 		}

	// 		if(attributeName === "intensity"){
	// 			guiContent["gamma"] = 0.5;
	// 			guiContent["brightness"] = 0;
	// 			guiContent["contrast"] = 0;
	// 		}else{

	// 			guiContent["gamma"] = 1;
	// 			guiContent["brightness"] = 0;
	// 			guiContent["contrast"] = 0;
	// 		}

	// 		guiContent["scalar min"] = low;
	// 		guiContent["scalar max"] = high;

	// 		guiScalarMin = guiScalarMin.min(low);
	// 		guiScalarMin = guiScalarMin.max(high);

	// 		guiScalarMax = guiScalarMax.min(low);
	// 		guiScalarMax = guiScalarMax.max(high);
			
	// 		console.log(attribute);

	// 	});

	// 	scene.root.children.push(pointcloud);

	// 	window.pointcloud = pointcloud;
	// });

	{
		let light1 = new PointLight("pointlight");
		light1.position.set(5, 5, 1);

		let light2 = new PointLight("pointlight2");
		light2.position.set(-5, -5, 1);

		scene.root.children.push(light1);
		scene.root.children.push(light2);
	}


	// loadGLB("./resources/models/lion.glb").then(node => {
	// 	scene.root.children.push(node);
	// 	controls.zoomTo(node);
	// });

	requestAnimationFrame(loop);

}

run();
