export interface MemeReaction {
  emoji: string;
  count: number;
}

export default interface Meme {
  date_unixtime: string;
  photo: string;
  width: number;
  height: number;
  reactions?: MemeReaction[];
  text?: string;
  chat_id?: string;
  message_id?: string;
}
