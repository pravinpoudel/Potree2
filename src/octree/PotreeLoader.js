
import {PointCloudOctree, Node} from "./PointCloudOctree.js";
import {Vector3} from "./../math/Vector3.js";
import {BoundingBox} from "./../math/BoundingBox.js";
import {WorkerPool} from "./../WorkerPool.js";
import {PointAttribute, getArrayType, toWebgpuAttribute, webgpuTypedArrayName} from "./PointAttributes.js";

let numLoading = 0;
let pool = new WorkerPool();
let dbg = 0;

function createChildAABB(aabb, index){
	let min = aabb.min.clone();
	let max = aabb.max.clone();
	let size = max.clone().sub(min);

	if ((index & 0b0001) > 0) {
		min.z += size.z / 2;
	} else {
		max.z -= size.z / 2;
	}

	if ((index & 0b0010) > 0) {
		min.y += size.y / 2;
	} else {
		max.y -= size.y / 2;
	}

	if ((index & 0b0100) > 0) {
		min.x += size.x / 2;
	} else {
		max.x -= size.x / 2;
	}

	return new BoundingBox(min, max);
}

function parseAttributes(jsonAttributes){

	let attributes = [];

	for(let jsonAttribute of jsonAttributes){
		let {name, description, type, size, numElements, elementSize} = jsonAttribute;

		let attribute = new PointAttribute(name, type, numElements);
		attribute.byteSize = size;
		attribute.description = description;

		attributes.push(attribute);
	}

	return attributes;
}

export class PotreeLoader{
	
	constructor(url){
		this.url = url;
		this.metadata = null;
		this.attributes = [];
	}

	async loadNode(node){

		if(node.loaded || node.loading){
			return;
		}

		if(numLoading >= 20){
			return;
		}

		node.loading = true;
		numLoading++;

		if(node.nodeType === 2){
			await this.loadHierarchy(node);
		}

		let {byteOffset, byteSize} = node;

		let promise = new Promise(async (resolve, reject) => {
			try{

					let urlOctree = `${this.url}/../octree.bin`;
					let first = byteOffset;
					let last = byteOffset + byteSize - 1n;

					let response = await fetch(urlOctree, {
						headers: {
							'content-type': 'multipart/byteranges',
							'Range': `bytes=${first}-${last}`,
						},
					});

					let buffer = await response.arrayBuffer();

					let workerPath = `${import.meta.url}/../PotreeDecoderWorker.js`;
					let worker = pool.getWorker(workerPath);

					worker.onmessage = (e) => {
						// console.log(`node loaded: ${node.name}`);
						// console.log(e);

						pool.returnWorker(workerPath, worker);

						let attributes = this.attributes;


						let attributeBuffers = e.data.attributeBuffers;
						
						if(dbg === 0){
							console.log(attributeBuffers);
						}
						dbg++;
						
						
						for(let buffer of attributeBuffers){
							let attribute = attributes.find(a => a.name === buffer.name);

							if(attribute){
								//let XArray = getArrayType(attribute.type);
								let webgpuAttribute = toWebgpuAttribute(attribute);
								let XArray = webgpuTypedArrayName(attribute.type);
								buffer.array = new XArray(buffer.array);
							}
						}
						node.buffers = attributeBuffers;
						node.loading = false;
						node.loaded = true;
						numLoading--;

						resolve();
					};

					let message = {
						name: node.name,
						buffer: buffer,
						attributes: this.attributes,
					};
					worker.postMessage(message, [message.buffer]);

			}catch(e){
				node.loaded = false;
				node.loading = false;
				numLoading--;

				console.log(`failed to load ${node.name}. trying again!`);
				reject();
			}
		});

		return promise;
	}

	async loadHierarchy(node){
		let {hierarchyByteOffset, hierarchyByteSize} = node;
		let hierarchyPath = `${this.url}/../hierarchy.bin`;
		
		let first = hierarchyByteOffset;
		let last = first + hierarchyByteSize - 1n;

		let response = await fetch(hierarchyPath, {
			headers: {
				'content-type': 'multipart/byteranges',
				'Range': `bytes=${first}-${last}`,
			},
		});

		let buffer = await response.arrayBuffer();
		let view = new DataView(buffer);

		let bytesPerNode = 22;
		let numNodes = buffer.byteLength / bytesPerNode;

		let nodes = [node];

		for(let i = 0; i < numNodes; i++){
			let current = nodes[i];

			// if(node === "r440040"){
			// 	debugger;
			// }

			let type = view.getUint8(i * bytesPerNode + 0);
			let childMask = view.getUint8(i * bytesPerNode + 1);
			let numPoints = view.getUint32(i * bytesPerNode + 2, true);
			let byteOffset = view.getBigInt64(i * bytesPerNode + 6, true);
			let byteSize = view.getBigInt64(i * bytesPerNode + 14, true);


			if(current.nodeType === 2){
				// replace proxy with real node
				current.byteOffset = byteOffset;
				current.byteSize = byteSize;
				current.numPoints = numPoints;
			}else if(type === 2){
				// load proxy
				current.hierarchyByteOffset = byteOffset;
				current.hierarchyByteSize = byteSize;
				current.numPoints = numPoints;
			}else{
				// load real node 
				current.byteOffset = byteOffset;
				current.byteSize = byteSize;
				current.numPoints = numPoints;
			}
			
			current.nodeType = type;

			for(let childIndex = 0; childIndex < 8; childIndex++){
				let childExists = ((1 << childIndex) & childMask) !== 0;

				if(!childExists){
					continue;
				}

				let childName = current.name + childIndex;

				let childAABB = createChildAABB(current.boundingBox, childIndex);
				let child = new Node();
				child.name = childName;
				child.boundingBox = childAABB;

				current.children[childIndex] = child;
				child.parent = current;

				nodes.push(child);
			}
		}

	}

	readBoundingBox(){
		let bbJson = this.metadata.boundingBox;
		let min = new Vector3(...bbJson.min);
		let max = new Vector3(...bbJson.max);
		let box = new BoundingBox(min, max);
		
		return box;
	}
	
	static async load(url){


		let response = await fetch(url);
		let metadata = await response.json();

		let attributes = parseAttributes(metadata.attributes);

		let loader = new PotreeLoader(url);
		loader.metadata = metadata;
		loader.attributes = attributes;
		loader.scale = metadata.scale;
		loader.offset = metadata.offset;

		let root = new Node();
		root.name = "r";
		root.boundingBox = loader.readBoundingBox();
		root.nodeType = 2;
		root.hierarchyByteOffset = 0n;
		root.hierarchyByteSize = BigInt(metadata.hierarchy.firstChunkSize);

		let octree = new PointCloudOctree();
		octree.boundingBox = root.boundingBox;
		octree.loader = loader;
		octree.root = root;
		octree.attributes = attributes;

		(async () => {
			//await loader.loadHierarchy(root);
			await loader.loadNode(root);
		})();
		


		return octree;
	}

}