// src/services/db.js
import { 
    getFirestore, collection, doc, onSnapshot, 
    query, where, addDoc, updateDoc, deleteDoc, setDoc, orderBy, 
    getDoc, getDocs, serverTimestamp // <--- getDocs TOEGEVOEGD
} from "https://www.gstatic.com/firebasejs/10.5.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.5.2/firebase-auth.js";
import { app } from "./config.js";

const db = getFirestore(app);

// --- EXPORT FIREBASE PRIMITIVES ---
// Hier maken we de functies beschikbaar voor de andere modules
export { db,
    getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, setDoc, 
    getDoc, getDocs, onSnapshot, query, where, orderBy, serverTimestamp, getAuth 
    // ^--- getDocs OOK HIER TOEGEVOEGD
};

// Helper to access the app instance if needed
export const getFirebaseApp = () => app;

// --- 1. Settings ---
export const subscribeToSettings = (uid, callback) => {
    return onSnapshot(doc(db, "settings", uid), (snap) => {
        callback(snap.exists() ? snap.data() : null);
    });
};

export const updateSettings = (uid, data) => {
    return setDoc(doc(db, "settings", uid), data, { merge: true });
};

// --- 2. Categories ---
export const subscribeToCategories = (callback) => {
    return onSnapshot(collection(db, "categories"), (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(list.filter(c => c.active !== false));
    });
};

// --- 3. Todos (Taken) ---
export const subscribeToTodos = (uid, callback) => {
    const q = query(collection(db, "todos"), where("uid", "==", uid));
    return onSnapshot(q, (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(list);
    });
};

export const addTask = (taskData) => {
    return addDoc(collection(db, "todos"), taskData);
};

export const updateTask = (taskId, data) => {
    return updateDoc(doc(db, "todos", taskId), data);
};

export const deleteTask = (taskId) => {
    return deleteDoc(doc(db, "todos", taskId));
};

// --- 4. Categories Management ---
export const addCategory = (data) => addDoc(collection(db, "categories"), data);
export const updateCategory = (id, data) => updateDoc(doc(db, "categories", id), data);
export const deleteCategory = (id) => deleteDoc(doc(db, "categories", id));

// --- 5. Time Segments ---
export const subscribeToSegments = (uid, callback) => {
    const q = query(collection(db, "timelogSegments"), where("uid", "==", uid));
    return onSnapshot(q, (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(list);
    });
};
export const addSegment = (data) => addDoc(collection(db, "timelogSegments"), data);
export const updateSegment = (id, data) => updateDoc(doc(db, "timelogSegments", id), data);
export const deleteSegment = (id) => deleteDoc(doc(db, "timelogSegments", id));

// --- 6. Planner ---
export const subscribeToSubjects = (uid, callback) => {
    const q = query(collection(db, "subjects"), where("uid", "==", uid), orderBy("name", "asc"));
    return onSnapshot(q, (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};
export const addSubject = (data) => addDoc(collection(db, "subjects"), data);
export const updateSubject = (id, data) => updateDoc(doc(db, "subjects", id), data);
export const deleteSubject = (id) => deleteDoc(doc(db, "subjects", id));

export const subscribeToBacklog = (uid, callback) => {
    const q = query(collection(db, "backlog"), where("uid", "==", uid), orderBy("subjectName", "asc"));
    return onSnapshot(q, (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};
export const addBacklogItem = (data) => addDoc(collection(db, "backlog"), data);
export const updateBacklogItem = (id, data) => updateDoc(doc(db, "backlog", id), data);
export const deleteBacklogItem = (id) => deleteDoc(doc(db, "backlog", id));

export const subscribeToPlans = (uid, start, end, callback) => {
    const q = query(
        collection(db, "plans"),
        where("uid", "==", uid),
        where("start", ">=", start),
        where("start", "<", end)
    );
    return onSnapshot(q, (snap) => {
        const items = snap.docs.map(d => {
            const data = d.data();
            return { 
                id: d.id, 
                ...data, 
                start: data.start?.toDate ? data.start.toDate() : new Date(data.start) 
            };
        });
        callback(items);
    });
};
export const addPlan = (data) => addDoc(collection(db, "plans"), data);
export const updatePlan = (id, data) => updateDoc(doc(db, "plans", id), data);
export const deletePlan = (id) => deleteDoc(doc(db, "plans", id));

// --- 7. Agenda Builder Config ---
export const getAgendaSettings = (uid) => getDoc(doc(db, "settings", uid));

export const subscribeToAgendaItems = (uid, type, callback) => {
    const q = query(
        collection(db, "agenda_items"), 
        where("uid", "==", uid), 
        where("type", "==", type),
        orderBy("created", "asc")
    );
    return onSnapshot(q, (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};
export const addAgendaItem = (data) => addDoc(collection(db, "agenda_items"), { ...data, created: Date.now() });
export const updateAgendaItem = (id, data) => updateDoc(doc(db, "agenda_items", id), data);
export const deleteAgendaItem = (id) => deleteDoc(doc(db, "agenda_items", id));

// ... (Houd de bovenste imports en exports zoals ze waren) ...

// --- 8. Workflow Columns ---
export const subscribeToColumns = (uid, boardId, callback) => {
    const q = query(
        collection(db, "workflowColumns"), 
        where("uid", "==", uid), 
        where("boardId", "==", boardId),
        orderBy("order", "asc")
    );
    return onSnapshot(q, (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};
export const addColumn = (data) => addDoc(collection(db, "workflowColumns"), data);
export const updateColumn = (id, data) => updateDoc(doc(db, "workflowColumns", id), data);
export const deleteColumn = (id) => deleteDoc(doc(db, "workflowColumns", id));

// --- 9. Workflow Tags (NIEUW) ---
export const subscribeToTags = (uid, callback) => {
    const q = query(collection(db, "workflowTags"), where("uid", "==", uid), orderBy("name", "asc"));
    return onSnapshot(q, (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};
export const addTag = (data) => addDoc(collection(db, "workflowTags"), data);
export const updateTag = (id, data) => updateDoc(doc(db, "workflowTags", id), data);
export const deleteTag = (id) => deleteDoc(doc(db, "workflowTags", id));

// --- 10. Workflow Checklist Templates (NIEUW) ---
export const subscribeToChecklistTemplates = (uid, callback) => {
    const q = query(collection(db, "workflowChecklistTemplates"), where("uid", "==", uid), orderBy("name", "asc"));
    return onSnapshot(q, (snap) => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
};
export const addChecklistTemplate = (data) => addDoc(collection(db, "workflowChecklistTemplates"), data);
export const deleteChecklistTemplate = (id) => deleteDoc(doc(db, "workflowChecklistTemplates", id));

