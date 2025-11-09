import { v4 as uuidv4 } from "uuid";

const KEY = 'inkwall_session_id';
export function getSessionId(){
let id = localStorage.getItem(KEY);
if (!id){
  id = crypto.randomUUID?.()?? uuidv4();
  localStorage.setItem(KEY,id);
  }
  return id;
}
