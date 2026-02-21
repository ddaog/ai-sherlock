import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          borderRadius: "4px",
          border: "2px solid #ad0000",
        }}
      >
        <span style={{ color: "#ad0000", fontSize: 18, fontWeight: 700 }}>A</span>
      </div>
    ),
    { width: size.width, height: size.height }
  );
}
