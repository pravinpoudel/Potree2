
import {Scene, SceneNode, Camera, OrbitControls} from "potree";
import {Renderer, Timer} from "potree";

import {render as renderPointsTest} from "./src/prototyping/renderPoints.js";
import {render as renderPointsCompute} from "./src/prototyping/renderPointsCompute.js";
import {drawTexture} from "./src/prototyping/textures.js";
import {createPointsData} from "./src/modules/geometries/points.js";
import {initGUI} from "./src/prototyping/gui.js";
import {Potree} from "potree";

import {render as renderPoints}  from "./src/potree/renderPoints.js";
// import {render as renderPoints}  from "./src/potree/arbitrary_attributes/renderPoints_arbitrary_attributes.js";

let frame = 0;
let lastFpsCount = 0;
let framesSinceLastCount = 0;
let fps = 0;

let renderer = null;
let camera = null;
let controls = null;

let scene = new Scene();
window.scene = scene;

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

	Timer.setEnabled(true);

	let renderables = new Map();

	camera.near = Math.max(controls.radius / 100, 0.001);
	camera.far = Math.max(controls.radius * 2, 100_000);

	let stack = [scene.root];
	while(stack.length > 0){
		let node = stack.pop();

		let nodeType = node.constructor.name;
		if(!renderables.has(nodeType)){
			renderables.set(nodeType, []);
		}
		renderables.get(nodeType).push(node);

		for(let child of node.children){

			child.updateWorld();
			child.world.multiplyMatrices(node.world, child.world);

			stack.push(child);
		}
	}

	let target = null;

	Timer.frameStart(renderer);
	
	if(guiContent["mode"] === "HQS"){
		let points = renderables.get("Points") ?? [];

		for(let point of points){
			target = renderPointsCompute(renderer, point, camera);
		}
	}

	let pass = renderer.start();

	if(target){
		drawTexture(renderer, pass, target, 0, 0, 1, 1);
	}

	if(guiContent["mode"] === "points"){
		let points = renderables.get("Points") ?? [];

		for(let point of points){
			renderPointsTest(renderer, pass, point, camera);
		}

		let octrees = renderables.get("PointCloudOctree") ?? [];
		for(let octree of octrees){

			octree.showBoundingBox = guiContent["show bounding box"];
			octree.pointBudget = guiContent["point budget (M)"] * 1_000_000;
			octree.pointSize = guiContent["point size"];
			octree.updateVisibility(camera);

			let numPoints = octree.visibleNodes.map(n => n.geometry.numElements).reduce( (a, i) => a + i, 0);
			let numNodes = octree.visibleNodes.length;

			guiContent["#points"] = numPoints.toLocaleString();
			guiContent["#nodes"] = numNodes.toLocaleString();

			renderPoints(renderer, pass, octree, camera);
		}
	}

	// if(pointcloud.pointSize === 1){
	// 	renderPoints(renderer, pass, pointcloud, camera);
	// }else{
	// 	renderQuads(renderer, pass, pointcloud, camera);
	// }

	renderer.renderDrawCommands(pass, camera);
	renderer.finish(pass);

	Timer.frameEnd(renderer);

}

function loop(){
	update();
	render();

	requestAnimationFrame(loop);
}

async function main(){

	initGUI();

	renderer = new Renderer();
	window.renderer = renderer;

	await renderer.init();

	camera = new Camera();
	controls = new OrbitControls(renderer.canvas);

	window.camera = camera;
	window.controls = controls;

	camera.fov = 60;

	controls.set({
		yaw: -0.2,
		pitch: 0.8,
		radius: 10,
	});

	// {
	// 	let points = createPointsData(1_000);
	// 	scene.root.children.push(points);

	// }

	Potree.load("./resources/pointclouds/lion/metadata.json").then(pointcloud => {
		camera.near = 0.5;
		camera.far = 10_000;

		controls.set({
			radius: 7,
			yaw: -0.86,
			pitch: 0.51,
			pivot: [-0.22, -0.01, 3.72],
		});

		scene.root.children.push(pointcloud);
	});

	requestAnimationFrame(loop);

}

main();
