if (typeof browser === "undefined") {
	var browser = chrome;
}
var scriptName = "reviews_templates.js";

function logError(errorArray) {
	const [functionName, scriptName, error] = errorArray;
	console.error(`${scriptName}-${functionName} generated the following error: ${error.message}`);
}

var reviewTemplates = [];

async function loadSettings() {
	try {
		let templateSet = await chrome.storage.local.get("reviews_templates");
		let reviews_templates = templateSet?.reviews_templates ?? [];
		if (Object.keys(reviews_templates).length === 0) {
			await chrome.storage.local.set({ reviews_templates: [] });
		}
		reviewTemplates = reviews_templates;
		if (reviewTemplates.length) {
			loadTemplates();
			displayTemplateSize();
		} else {
			const templateTable = document.getElementById("templates_list");
			templateTable.style.display = "none";
		}
	} catch (e) {
		logError([scriptName, "loadSettings", e.message]);
	}
}

async function displayTemplateSize() {
	document.getElementById("storage-used").textContent =
		`Currently using: ${await getStorageKeySizeinBytes("reviews_templates")}`;
}

function loadTemplates() {
	try {
		const tableBody = document.getElementById("templates_list").querySelector("tbody");

		reviewTemplates.forEach((template) => {
			let { id, title } = template;

			const row = tableBody.insertRow();
			const actionCell = row.insertCell();
			const titleCell = row.insertCell();
			row.id = id;

			// Create edit button
			const editButton = document.createElement("button");
			editButton.id = "edit";
			editButton.dataset.id = id;
			editButton.className = "vh-button";
			editButton.textContent = "Edit";

			// Create delete button
			const deleteButton = document.createElement("button");
			deleteButton.id = "delete";
			deleteButton.dataset.id = id;
			deleteButton.className = "vh-button";
			deleteButton.textContent = "Delete";

			actionCell.appendChild(editButton);
			actionCell.appendChild(deleteButton);
			titleCell.textContent = `${JSON.parse(title)}`;
		});
	} catch (e) {
		logError(["loadSettings", scriptName, e]);
	}
}

function getTemplate(id) {
	try {
		return reviewTemplates.find((template) => template.id === id);
	} catch (e) {
		logError(["getTemplate", scriptName, e.message]);
	}
}

async function handleSaveClick() {
	try {
		const title = document.getElementById("template_title").value.trim();
		const content = document.getElementById("template_content").value.trim();
		const templateId = document.getElementById("template_id").value;
		if (!title || !content) return;

		if (templateId !== "new") {
			updateTemplate(templateId, title, content);
		} else {
			newTemplate(title, content);
		}
	} catch (e) {
		logError(["handleSaveClick", scriptName, e.message]);
	}
}

async function handleResetClick() {
	try {
		document.getElementById("form_action").textContent = "New template";
		document.getElementById("template_id").value = "new";
	} catch (e) {
		logError(["handleResetClick", scriptName, e.message]);
	}
}

async function handleEditClick(id) {
	try {
		const template = getTemplate(id);
		if (template) {
			let { content, title, id } = template;
			document.getElementById("form_action").textContent = "Edit template";
			document.getElementById("template_id").value = id;
			document.getElementById("template_title").value = JSON.parse(title);
			document.getElementById("template_content").value = JSON.parse(content);
		}
	} catch (e) {
		logError(["handleEditClick", scriptName, e.message]);
	}
}

async function handleDeleteClick(id) {
	try {
		if (confirm("Delete this template?")) {
			await deleteTemplate(id);
		}
	} catch (e) {
		logError(["handleDeleteClick", scriptName, e.message]);
	}
}

const events = {
	edit: handleEditClick,
	delete: handleDeleteClick,
	save: handleSaveClick,
	reset: handleResetClick,
};

document.addEventListener("click", (event) => {
	const { target } = event;
	if (target.tagName !== "BUTTON") return;
	const eventHandler = events[target.id];
	if (eventHandler) {
		eventHandler(target.dataset.id);
	}
});

async function deleteTemplate(id) {
	try {
		const index = reviewTemplates.findIndex((template) => template.id === id);
		const filteredTemplates = reviewTemplates.filter((template, i) => i !== index);
		await chrome.storage.local.set({ reviews_templates: filteredTemplates });
		location.reload();
	} catch (e) {
		logError(["deleteTemplate", scriptName, e.message]);
	}
}

async function newTemplate(title, content) {
	try {
		reviewTemplates.push({
			id: crypto.randomUUID(),
			title: JSON.stringify(title),
			content: JSON.stringify(content),
		});
		await chrome.storage.local.set({ reviews_templates: reviewTemplates });
		location.reload();
	} catch (e) {
		logError(["createNewTemplate", scriptName, e.message]);
	}
}

async function updateTemplate(id, title, content) {
	try {
		const index = reviewTemplates.findIndex((template) => template.id === id);
		reviewTemplates[index] = { id: id, title: JSON.stringify(title), content: JSON.stringify(content) };
		await chrome.storage.local.set({ reviews_templates: reviewTemplates });
		location.reload();
	} catch (e) {
		logError(["editNewTemplate", scriptName, e.message]);
	}
}

function bytesToSize(bytes, decimals = 2) {
	if (!Number(bytes)) {
		return "0 Bytes";
	}

	const kbToBytes = 1024;
	const dm = decimals < 0 ? 0 : decimals;
	const sizes = ["Bytes", "KB", "MB", "GB", "TB"];

	const index = Math.floor(Math.log(bytes) / Math.log(kbToBytes));

	return `${parseFloat((bytes / Math.pow(kbToBytes, index)).toFixed(dm))} ${sizes[index]}`;
}
function getStorageKeySizeinBytes(key) {
	return new Promise((resolve, reject) => {
		chrome.storage.local.get(key, function (items) {
			if (chrome.runtime.lastError) {
				reject(new Error(chrome.runtime.lastError.message));
			} else {
				const storageSize = JSON.stringify(items[key]).length;
				resolve(bytesToSize(storageSize));
			}
		});
	});
}

window.addEventListener("DOMContentLoaded", function () {
	loadSettings();
});
