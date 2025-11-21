# Workflow board – Firestore model

## Doel

Eén board zoals Trello.  
Kolommen met kaarten.  
Kaarten kunnen tags hebben.

## Collecties

### 1. workflowBoards

Eén document per board.

Velden:
- uid: string, eigenaar van het board
- name: string, naam van het board
- isDefault: boolean, standaard board voor deze gebruiker
- createdAt: timestamp

### 2. workflowColumns

Kolommen per board.

Velden:
- boardId: string, verwijzing naar workflowBoards doc id
- uid: string, eigenaar (zelfde als eigenaar van het board)
- title: string, naam van de kolom, bv. “Backlog”
- order: number, sorteerindex van de kolom
- createdAt: timestamp

### 3. workflowCards

Kaarten op het board.

Velden:
- boardId: string, verwijzing naar workflowBoards
- columnId: string, verwijzing naar workflowColumns
- uid: string, eigenaar van de kaart (zelfde als board eigenaar)
- title: string, korte titel van de kaart
- description: string, langere omschrijving
- tags: array<string>, lijst van tag ids
- sort: number, sorteerindex binnen de kolom
- status: string, optioneel, bijvoorbeeld gelijk aan kolomnaam
- createdAt: timestamp
- updatedAt: timestamp
- dueDate: timestamp of null

### 4. workflowTags

Beschikbare tags voor een board.

Velden:
- boardId: string, verwijzing naar workflowBoards
- uid: string, eigenaar
- name: string, naam van de tag
- color: string, hex kleurcode, bv. “#ffcc00”
- active: boolean, tag nog in gebruik ja of nee
- createdAt: timestamp
