require("fidget").setup()
require("mason").setup()
require("mason-lspconfig").setup({
	ensure_installed = {
		"astro",
		"eslint",
		"jdtls",
		"prismals",
		"pyright",
		"rust_analyzer",
		"solargraph",
		"sumneko_lua",
		"tailwindcss",
		"texlab",
		"tsserver",
	},
})

local lspconfig = require("lspconfig")
local saga = require("lspsaga")

saga.init_lsp_saga()

local on_attach = function(client, bufnr)
	local function buf_set_keymap(...)
		vim.api.nvim_buf_set_keymap(bufnr, ...)
	end

	local noremap_silent_opts = { noremap = true, silent = true }

	client.server_capabilities.documentFormatting = false
	client.server_capabilities.documentFormatting = false

	buf_set_keymap("n", "gD", "<Cmd>lua vim.lsp.buf.declaration()<CR>", noremap_silent_opts)
	buf_set_keymap("n", "gd", "<Cmd>lua vim.lsp.buf.definition()<CR>", noremap_silent_opts)
	buf_set_keymap("n", "gi", "<cmd>lua vim.lsp.buf.implementation()<CR>", noremap_silent_opts)
	buf_set_keymap("n", "gt", "<cmd>lua vim.lsp.buf.type_definition()<CR>", noremap_silent_opts)
	buf_set_keymap("n", "<leader>rn", "<cmd>Lspsaga rename<CR>", noremap_silent_opts)
	buf_set_keymap("n", "gr", "<cmd>Lspsaga lsp_finder<CR>", noremap_silent_opts)
	buf_set_keymap("n", "<leader>ec", "<cmd>Lspsaga show_cursor_diagnostics<CR>", noremap_silent_opts)
	buf_set_keymap("n", "<leader>e", "<cmd>Lspsaga show_line_diagnostics<CR>", noremap_silent_opts)
	buf_set_keymap("n", "]g", "<cmd>Lspsaga diagnostic_jump_next<CR>", noremap_silent_opts)
	buf_set_keymap("n", "[g", "<cmd>Lspsaga diagnostic_jump_prev<CR>", noremap_silent_opts)
	buf_set_keymap("n", "K", "<cmd>Lspsaga hover_doc<CR>", noremap_silent_opts)
	buf_set_keymap("n", "<leader>do", "<cmd>Lspsaga code_action<CR>", { silent = true })
end

local capabilities = require("cmp_nvim_lsp").default_capabilities()

require("mason-lspconfig").setup_handlers({
	function(server_name)
		lspconfig[server_name].setup({
			on_attach = on_attach,
			capabilities = capabilities,
		})
	end,

	["sumneko_lua"] = function()
		lspconfig["sumneko_lua"].setup({
			on_attach = on_attach,
			capabilities = capabilities,
			settings = {
				Lua = {
					runtime = {
						version = "LuaJIT",
					},
					diagnostics = {
						globals = { "vim" },
					},
					workspace = {
						library = {
							[vim.fn.expand("$VIMRUNTIME/lua")] = true,
							[vim.fn.expand("$VIMRUNTIME/lua/vim/lsp")] = true,
						},
					},
				},
			},
		})
	end,
})