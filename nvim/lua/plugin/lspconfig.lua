return function()
	require("nvim-lsp-installer").setup({})
	vim.lsp.set_log_level("debug")
	local lspconfig = require("lspconfig")
	local saga = require("lspsaga")

	saga.init_lsp_saga()

	local function filter(name)
		return name ~= nil and name ~= "eslint" and name ~= "tailwindcss"
	end

	function _G.do_rename()
		vim.lsp.buf.rename(nil, {
			filter = function(clients)
				local names = vim.tbl_filter(filter, clients)

				return #names ~= 0
			end,
		})
	end

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

	local servers = {
		["tailwindcss"] = {
			filetypes = { "javascriptreact", "typescriptreact" },
			on_attach = on_attach,
		},
		["eslint"] = { on_attach = on_attach },
		["tsserver"] = {
			on_attach = on_attach,
			filetypes = { "typescript", "typescriptreact", "typescript.tsx", "javascript" },
		},
		["solargraph"] = { on_attach = on_attach },
		["sumneko_lua"] = {
			on_attach = on_attach,
			settings = {
				Lua = {
					runtime = {
						version = "LuaJIT",
					},
					diagnostics = {
						globals = { "vim" },
					},
				},
			},
		},
		["jdtls"] = { on_attach = on_attach },
		["pyright"] = { on_attach = on_attach },
		["rust_analyzer"] = { on_attach = on_attach },
		["ansiblels"] = { on_attach = on_attach },
		["texlab"] = { on_attach = on_attach },
	}

	local capabilities = require("cmp_nvim_lsp").update_capabilities(vim.lsp.protocol.make_client_capabilities())
	for name, opts in pairs(servers) do
		lspconfig[name].setup(vim.tbl_extend("keep", opts, { capabilities = capabilities }))
	end
end
